"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Fw24 = void 0;
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_sns_1 = require("aws-cdk-lib/aws-sns");
const aws_sqs_1 = require("aws-cdk-lib/aws-sqs");
const di_1 = require("../di");
const construct_1 = require("../interfaces/construct");
const logging_1 = require("../logging");
const helper_1 = require("./helper");
const keys_1 = require("../utils/keys");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_ssm_1 = require("aws-cdk-lib/aws-ssm");
const aws_route53_1 = require("aws-cdk-lib/aws-route53");
class Fw24 {
    logger = (0, logging_1.createLogger)(Fw24.name);
    appName = "fw24";
    emailProvider;
    config = {};
    app;
    stacks = {};
    apis = {};
    environmentVariables = {};
    globalEnvironmentVariables = [];
    policyStatements = new Map();
    defaultAuthorizer;
    cognitoAuthorizers = {};
    jwtAuthorizer;
    dynamoTables = {};
    static instance;
    queues = new Map();
    topics = new Map();
    modules = new Map();
    constructs = new Map();
    globalLambdaLayerNames = new Set();
    globalLambdaEntryPackages = new Map(); // package -> priority
    systemUIConfigs = new Map();
    systemControllers = new Map();
    constructor() { } // Empty constructor as App is set via setApp()
    static getInstance() {
        if (!Fw24.instance) {
            Fw24.instance = new Fw24();
        }
        return Fw24.instance;
    }
    setApp(app) {
        this.app = app;
    }
    getApp() {
        return this.app;
    }
    setConfig(config) {
        this.config = config;
        // Hydrate the config object with environment variables
        helper_1.Helper.hydrateConfig(this.config);
        // Set the app name
        this.appName = config.name;
    }
    getConfig() {
        return this.config;
    }
    getAppDIContainer() {
        return this.config.appDIContainer || di_1.DIContainer.ROOT;
    }
    getLambdaEntryPackages() {
        if (this.config.lambdaEntryPackages) {
            return this.config.lambdaEntryPackages;
        }
        // Sort entry packages by priority (lower number = loaded first)
        return Array.from(this.globalLambdaEntryPackages.entries())
            .sort((a, b) => a[1] - b[1]) // Sort by priority
            .map(([packageName]) => packageName);
    }
    addGlobalLambdaEntryPackage(packageName, priority = 999) {
        this.globalLambdaEntryPackages.set(packageName, priority);
    }
    hasGlobalLambdaEntryPackage(packageName) {
        return this.globalLambdaEntryPackages.has(packageName);
    }
    removeGlobalLambdaEntryPackage(packageName) {
        this.globalLambdaEntryPackages.delete(packageName);
    }
    getGlobalLambdaLayerNames() {
        return this.globalLambdaLayerNames;
    }
    addGlobalLambdaLayerNames(layerName) {
        this.globalLambdaLayerNames.add(layerName);
    }
    hasGlobalLambdaLayerNames(layerName) {
        return this.globalLambdaLayerNames.has(layerName);
    }
    removeGlobalLambdaLayerNames(layerName) {
        this.globalLambdaLayerNames.delete(layerName);
    }
    addStack(name, stack) {
        this.logger.debug("addStack:", { name });
        this.stacks[name] = stack;
        return this;
    }
    /**
     * Get a stack by name. If the stack does not exist, create it.
     *
     * @param name - The name of the stack to get.
     * @param parentStackName - The name of the parent stack.
     * @returns The stack.
     */
    getStack(name, parentStackName) {
        let stackName = name ? name : this.getDefaultStackName();
        // don't allow nested stacks if multiStack is true, multistack is used for creating independent stacks
        if (this.config.multiStack && parentStackName) {
            throw new Error('Nested stacks are not allowed when multiStack is true. Please use multiStack: false or remove the parentStackName parameter.');
        }
        // if the stack does not exist and multiStack is false and parentStackName is not provided, then use the default stack name
        if (this.stacks[stackName] === undefined && !(this.config.multiStack || parentStackName)) {
            stackName = this.getDefaultStackName();
        }
        this.logger.debug("Getting Stack With Name:", { stackName });
        if (this.stacks[stackName] === undefined) {
            if (parentStackName) {
                // create a new nested stack
                this.stacks[stackName] = new aws_cdk_lib_1.NestedStack(this.getStack(parentStackName), stackName);
                this.logger.debug("Created nested stack:", { stackName, parentStackName });
            }
            else {
                let stackID = `${this.appName}-${stackName}-stack`;
                // backwards compatibility for old stack names
                if (stackName === 'premultistack') {
                    stackID = `${this.appName}-stack`;
                }
                // create a new stack
                this.stacks[stackName] = new aws_cdk_lib_1.Stack(this.app, stackID, {
                    env: {
                        account: this.config.account,
                        region: this.config.region
                    }
                });
                // make all stacks dependent on the layer stack
                const layerStack = this.getStack(this.config.layerStackName);
                if (layerStack) {
                    this.stacks[stackName].addDependency(layerStack);
                }
                this.logger.debug("Created stack:", { stackName });
            }
        }
        return this.stacks[stackName];
    }
    getDefaultStackName() {
        return this.config.defaultStackName || 'main';
    }
    useMultiStackSetup = (currentStackName, resourceStack) => {
        return (this.getConfig().multiStack
            && this.getConfig().multiStack === true
            && (
            // if resource stack is not provided, then only check if multi-stack is enabled
            !resourceStack ||
                // if resource stack is provided, then check if it is a different stack than the current stack
                !(resourceStack?.stackName.endsWith(currentStackName + '-stack') || resourceStack?.stackName === currentStackName))) || false;
    };
    addAPI(apiConstructName, name, api, isImported = false) {
        // Initialize the apiConstructName object if it doesn't exist
        if (!this.apis[apiConstructName]) {
            this.apis[apiConstructName] = {};
        }
        this.logger.debug("addAPI:", { name });
        this.apis[apiConstructName][name] = { api: api, isImported: isImported };
        return this;
    }
    getAPI(apiConstructName, name) {
        // Check if API exists for the given name and stack
        if (!this.apis[apiConstructName] || !this.apis[apiConstructName][name]) {
            this.logger.debug(`API not found: construct name ${apiConstructName} and name ${name}`);
            return undefined;
        }
        return this.apis[apiConstructName][name];
    }
    getAPIs(apiConstructName) {
        return this.apis[apiConstructName];
    }
    hasImportedAPI(apiConstructName) {
        if (!this.apis[apiConstructName]) {
            return false;
        }
        // Check if any API in any stack is marked as imported
        return Object.values(this.apis[apiConstructName])
            .some(api => api.isImported === true);
    }
    addModule(name, module) {
        this.logger.debug("addModule:", { name, module: module.getBasePath() });
        // collect all exported policies from this module
        for (const [policyName, policy] of module.getExportedPolicies()) {
            this.setPolicy(policyName, policy, module.getName());
        }
        // add all exported static env values into the FW24 scope
        for (const [envName, envValue] of module.getExportedEnvironmentVariables()) {
            this.setEnvironmentVariable(envName, envValue, module.getName());
        }
        this.modules.set(name, module);
    }
    getModules() {
        return this.modules;
    }
    hasModules() {
        return this.modules.size > 0;
    }
    getUniqueName(name) {
        return `${name}-${this.config.name}-${this.config.environment || 'env'}-${this.config.account}`;
    }
    getArn(type, name) {
        return `arn:aws:${type}:${this.config.region}:${this.config.account}:${name}`;
    }
    setCognitoAuthorizer(name, authorizer, defaultAuthorizer = false) {
        this.logger.debug("setCognitoAuthorizer: ", { name, authorizer: authorizer.authorizerId, defaultAuthorizer });
        this.cognitoAuthorizers[name] = authorizer;
        // If this authorizer is the default, set it as the default authorizer
        if (defaultAuthorizer !== false) {
            this.defaultAuthorizer = authorizer;
        }
    }
    getCognitoAuthorizer(name) {
        this.logger.info("getCognitoAuthorizer: ", { name });
        // If no name is provided and no default authorizer is set, throw an error
        if (name === undefined && this.defaultAuthorizer === undefined) {
            throw new Error('No Authorizer exists for cognito user pools. For policy based authentication, use AWS_IAM authoriser.');
        }
        // If no name is provided, return the default authorizer
        if (name === undefined) {
            return this.defaultAuthorizer;
        }
        // if authorizer with name is not found, throw an error
        if (this.cognitoAuthorizers[name] === undefined) {
            throw new Error(`Authorizer with name: ${name} not found`);
        }
        // If a name is provided, return the authorizer with that name
        return this.cognitoAuthorizers[name];
    }
    getAuthorizer(authorizationType, name) {
        if (authorizationType === "COGNITO_USER_POOLS") {
            return this.getCognitoAuthorizer(name);
        }
        if (authorizationType === "JWT") {
            return this.getJwtAuthorizer();
        }
        return undefined;
    }
    setDefaultCognitoAuthorizerName(name) {
        this.setEnvironmentVariable('defaultCognitoAuthorizerName', name, 'cognito');
    }
    getDefaultCognitoAuthorizerName() {
        return this.getEnvironmentVariable('defaultCognitoAuthorizerName', 'cognito');
    }
    setEnvironmentVariable(name, value, prefix = '') {
        this.environmentVariables[(0, keys_1.ensureValidEnvKey)(name, prefix)] = value;
    }
    getEnvironmentVariable(name, prefix = '', scope) {
        // if lookup is for construct output (based on prefix being one of the output types)
        // and the application has multiple stacks, then look for value in the stack export
        // if the scope is defined and is a stack and the output is from the same stack, then return the value
        if (prefix.length > 0 && scope && scope instanceof aws_cdk_lib_1.Stack && this.useMultiStackSetup()) {
            const isPrefixOutputType = Object.values(construct_1.OutputType).includes(prefix.split('_')[0]);
            if (isPrefixOutputType) {
                // Check for SSM parameter reference
                // make sure the key is specified as qualified key i.e. key_exportValueKey
                // it is possible that the key is not qualified if the prefix has output type and key name. ie. prefix: userpool_authmodule, key: userPoolId
                if (!name.includes('_') && !prefix.includes('_')) {
                    throw new Error(`Environment variable ${name} is not a qualified key. Please specify as key_exportValueKey. e.g. restAPI_restApiId`);
                }
                const ssmKey = this.environmentVariables[(0, keys_1.ensureValidEnvKey)(name, `SSM:${prefix}`)];
                if (ssmKey) {
                    const stackName = ssmKey.split('/')[1];
                    this.logger.debug(`Checking if multi-stack setup should be used for environment variable: ${(0, keys_1.ensureValidEnvKey)(name, prefix)} in stack: ${stackName} called from stack: ${scope.stackName} - ${this.useMultiStackSetup(stackName, scope)}`);
                    if (this.useMultiStackSetup(stackName, scope)) {
                        // Add cross-stack dependency
                        const sourceStack = this.stacks[stackName];
                        if (sourceStack) {
                            scope.addDependency(sourceStack);
                            this.logger.debug(`Added dependency from ${scope.stackName} to ${stackName} for SSM key: ${ssmKey}`);
                        }
                        try {
                            this.logger.debug(`Attempting to import SSM value for key: ${ssmKey}`);
                            return aws_ssm_1.StringParameter.valueForStringParameter(scope, ssmKey);
                        }
                        catch (error) {
                            this.logger.error(error);
                        }
                    }
                }
                else {
                    this.logger.warn(`No SSM key found in environment variables for key: ${(0, keys_1.ensureValidEnvKey)(name, `SSM:${prefix}`)}, using direct reference`);
                }
            }
        }
        return this.environmentVariables[(0, keys_1.ensureValidEnvKey)(name, prefix)];
    }
    hasEnvironmentVariable(name, prefix = '') {
        return ((0, keys_1.ensureValidEnvKey)(name, prefix) in this.environmentVariables);
    }
    resolveEnvVariables = (env = [], scope) => {
        const resolved = {};
        for (const envConfig of env) {
            const value = envConfig.value ?? this.getEnvironmentVariable(envConfig.name, envConfig.prefix, scope);
            if (value) {
                resolved[envConfig.exportName ?? envConfig.name] = value;
            }
            else {
                this.logger.warn(`Environment variable [prefix: ${envConfig.prefix}] ${envConfig.name} not found in the environment variables.`);
            }
        }
        return resolved;
    };
    /**
     * Resolves the value for the given template from the Fw24-scope env if it follows the conventions like `env:xxx:yyy`, `env:yyy`.
     *
     * @param keyTemplate - The template for the environment key to resolve.
     *  e.g. env:Users_Table_name, env:userModule:Users_Table_name
     * @returns The resolved value for the key.
     */
    tryResolveEnvKeyTemplate = (keyTemplate) => {
        if (keyTemplate.startsWith('env:')) {
            // env:userModule:Users_Table_name => ['env', 'userModule', 'Users_Table_name'];
            const parts = keyTemplate.split(':');
            // get the actual value from the fw24 scope ==> fw24.get('Users_Table_name', 'userModule');
            keyTemplate = parts.length === 3 ? this.getEnvironmentVariable(parts[2], parts[1]) : this.getEnvironmentVariable(parts[1]);
        }
        return keyTemplate;
    };
    /**
     * Set a global environment variable. This variable will be available to all lambda functions.
     * @param name The name of the environment variable.
     * @param value The value of the environment variable.
     */
    setGlobalEnvironmentVariable(name, value) {
        this.logger.info("setGlobalEnvironmentVariable:", name, value);
        this.setEnvironmentVariable(name, value, '');
        this.globalEnvironmentVariables.push((0, keys_1.ensureValidEnvKey)(name, ''));
    }
    getGlobalEnvironmentVariables() {
        return this.globalEnvironmentVariables;
    }
    setPolicy(policyName, value, prefix = '') {
        this.logger.debug("setPolicy:", prefix, policyName, value);
        this.policyStatements.set((0, keys_1.ensureValidEnvKey)(policyName, prefix), value);
    }
    getPolicy(policyName, prefix = '') {
        return this.policyStatements.get((0, keys_1.ensureValidEnvKey)(policyName, prefix));
    }
    hasPolicy(policyName, prefix = '') {
        return this.policyStatements.has((0, keys_1.ensureValidEnvKey)(policyName, prefix));
    }
    // set the output of a construct
    // if exportValueAlias is not provided, the export value key will be used as the environment variable key. i.e when using custom resource like CfnIdentityPool 
    // the output is the reference to the custom resource. The reference is not the physical id of the custom resource, but a logical id
    // that is resolved to the physical id at runtime. In this case, the exportValueAlias is the key name of the custom resource.
    setConstructOutput(construct, key, value, outputType, exportValueKey, exportValueAlias) {
        this.logger.debug(`setConstructOutput: ${construct.name}`, { outputType, key });
        if (outputType) {
            construct.output = {
                ...construct.output,
                [outputType]: {
                    ...construct.output?.[outputType],
                    [key]: value
                }
            };
            this.setEnvironmentVariable(key, value, `${construct.name}_${outputType}`);
            this.logger.debug(`setEnvironmentVariable: ${key}`, { prefix: `${construct.name}_${outputType}` });
            // in case of object reference, export the output to be used in other stacks
            let outputValue = value;
            if (typeof value === 'object' && exportValueKey) {
                outputValue = value[exportValueKey];
            }
            else if (typeof value === 'object' && exportValueKey === undefined) {
                return;
            }
            else if (typeof value !== 'object') {
                return;
            }
            // Create CloudFormation export with valid naming
            const sanitizedKey = (0, keys_1.ensureValidEnvKey)(key, '', '', true);
            const exportKey = `${outputType}${sanitizedKey}${exportValueAlias || exportValueKey}`;
            const stackExportName = `${construct.mainStack.stackName}-${exportKey}`;
            new aws_cdk_lib_1.CfnOutput(construct.mainStack, exportKey, {
                value: outputValue,
                exportName: stackExportName,
            });
            // set the environment variable for the direct reference
            this.setEnvironmentVariable(`${key}_${exportValueAlias || exportValueKey}`, outputValue, outputType);
            // Store SSM parameter for cross-stack reference
            this.logger.debug(`useMultiStackSetup: ${this.useMultiStackSetup()}`);
            if (this.useMultiStackSetup()) {
                const ssmKey = `/${construct.mainStack.stackName}/${outputType}/${sanitizedKey}/${exportValueAlias || exportValueKey}`;
                // set the environment variable for the cross-stack reference using SSM parameter
                this.setEnvironmentVariable(`${key}_${exportValueAlias || exportValueKey}`, ssmKey, `SSM:${outputType}`);
                new aws_ssm_1.StringParameter(construct.mainStack, `SSM${outputType}${sanitizedKey}${exportValueAlias || exportValueKey}`, {
                    parameterName: ssmKey,
                    stringValue: outputValue,
                });
            }
        }
        else {
            construct.output = {
                ...construct.output,
                [key]: value
            };
            this.setEnvironmentVariable(key, value, construct.name);
        }
    }
    addDynamoTable(name, table) {
        name = (0, keys_1.ensureNoSpecialChars)(name);
        this.logger.debug("addDynamoTable:", { name });
        this.dynamoTables[name] = table;
    }
    getDynamoTable(name) {
        return this.dynamoTables[(0, keys_1.ensureNoSpecialChars)(name)];
    }
    /**
     * Gets a queue reference by name, following the framework's pattern for existing resource references.
     * @param queueName The name of the queue
     * @param scope Optional scope for stack resolution
     * @param constructId Optional construct ID for unique naming
     * @returns Queue instance referenced by ARN
     */
    getQueueByName(queueName, scope, constructId) {
        const queueUrl = this.getEnvironmentVariable(queueName + '_queueName', 'queue', scope);
        const queueArn = this.getArn('sqs', queueUrl);
        const uniqueId = constructId ? `${constructId}-${queueName}-queue` : `${queueName}-queue`;
        return aws_sqs_1.Queue.fromQueueArn(scope ?? this.getStack(), uniqueId, queueArn);
    }
    /**
     * Gets a topic reference by name, following the framework's pattern for existing resource references.
     * @param topicName The name of the topic
     * @param scope Optional scope for stack resolution
     * @param constructId Optional construct ID for unique naming
     * @returns Topic instance referenced by ARN
     */
    getTopicByName(topicName, scope, constructId) {
        const topicArnValue = this.getEnvironmentVariable(topicName, 'topicName');
        const topicArn = this.getArn('sns', topicArnValue);
        const uniqueId = constructId ? `${constructId}-${topicName}-topic` : `${topicName}-topic`;
        return aws_sns_1.Topic.fromTopicArn(scope ?? this.getStack(), uniqueId, topicArn);
    }
    addRouteToRolePolicy(route, groups, requireRouteInGroupConfig = false) {
        if (!groups || groups.length === 0) {
            groups = this.getEnvironmentVariable('Groups', 'cognito');
            if (!groups) {
                this.logger.warn(`No groups defined. Adding route: ${route} to role policy for default authenticated role.`);
                groups = ['default'];
            }
        }
        let routeAddedToGroupPolicy = false;
        for (const groupName of groups) {
            // if requireRouteInGroupConfig is true, check if the route is in the group config
            if (requireRouteInGroupConfig && (!this.getEnvironmentVariable('Routes', 'cognito_' + groupName) || !this.getEnvironmentVariable('Routes', 'cognito_' + groupName).includes(route))) {
                continue;
            }
            // get role
            this.logger.debug("addRouteToRolePolicy:", { route, groupName });
            const role = this.getEnvironmentVariable('Role', 'cognito_' + groupName);
            if (!role) {
                this.logger.error(`Role not found for group: ${groupName}. Role is required to add route: ${route} to role policy. Please make sure you have a group defined in your config with the name: ${groupName}.`);
                return;
            }
            // add role policy statement to allow route access for group
            role.addToPolicy(this.getRoutePolicyStatement(route));
            routeAddedToGroupPolicy = true;
        }
        if (!routeAddedToGroupPolicy) {
            this.logger.error(`Route ${route} not found in any group config. Please add the route to a group config to secure access.`);
        }
    }
    getRoutePolicyStatement(route) {
        // write the policy statement
        const statement = new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: ['execute-api:Invoke'],
            resources: [`arn:aws:execute-api:*:*:*/*/*/${route}`],
        });
        this.logger.debug("RoutePolicyStatement:", { route });
        return statement;
    }
    getConstructOutput(type, name) {
        // Look through all constructs to find the output
        for (const construct of this.constructs.values()) {
            if (construct.output?.[type]?.[name]) {
                return construct.output[type][name];
            }
        }
        return undefined;
    }
    addConstruct(construct) {
        this.constructs.set(construct.name, construct);
    }
    getVpc(vpcName) {
        const vpc = this.getConstructOutput(construct_1.OutputType.VPC, vpcName);
        if (!vpc) {
            throw new Error(`VPC ${vpcName} not found`);
        }
        return vpc;
    }
    getHostedZone(domainName) {
        // Look up the hosted zone by domain name
        return aws_route53_1.HostedZone.fromLookup(this.app, `${domainName}-zone`, {
            domainName,
        });
    }
    setJwtAuthorizer(authorizer, defaultAuthorizer = false) {
        this.logger.debug("setJwtAuthorizer: ", { authorizer: authorizer.authorizerId });
        this.jwtAuthorizer = authorizer;
        if (defaultAuthorizer) {
            this.defaultAuthorizer = authorizer;
            this.getConfig().defaultAuthorizationType = 'JWT';
        }
    }
    getJwtAuthorizer() {
        return this.jwtAuthorizer;
    }
    registerSystemController(controller) {
        this.systemControllers.set(controller.path, controller);
    }
    hasSystemController(path) {
        return this.systemControllers.has(path);
    }
    getSystemController(path) {
        return this.systemControllers.get(path);
    }
    hasSystemControllers() {
        return this.systemControllers.size > 0;
    }
    getSystemControllers() {
        return Array.from(this.systemControllers.values());
    }
    async registerSystemUIConfig(name, config) {
        this.systemUIConfigs.set(name, config);
    }
    hasSystemUIConfig(name) {
        return this.systemUIConfigs.has(name);
    }
    getSystemUIConfig(name) {
        return this.systemUIConfigs.get(name);
    }
    getSystemUIConfigs() {
        return Array.from(this.systemUIConfigs.values());
    }
    hasSystemUIConfigs() {
        return this.systemUIConfigs.size > 0;
    }
}
exports.Fw24 = Fw24;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZncyNC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb3JlL2Z3MjQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRUEsaURBQW9HO0FBRXBHLGlEQUE0QztBQUM1QyxpREFBb0Q7QUFDcEQsOEJBQW9DO0FBR3BDLHVEQUFvRTtBQUVwRSx3Q0FBMEM7QUFDMUMscUNBQWtDO0FBRWxDLHdDQUF3RTtBQUN4RSw2Q0FBcUU7QUFDckUsaURBQXNEO0FBRXRELHlEQUFrRTtBQUVsRSxNQUFhLElBQUk7SUFDSixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUUxQyxPQUFPLEdBQVcsTUFBTSxDQUFDO0lBQ3pCLGFBQWEsQ0FBTTtJQUVYLE1BQU0sR0FBdUIsRUFBRSxDQUFDO0lBQ2hDLEdBQUcsQ0FBTztJQUNWLE1BQU0sR0FBMEIsRUFBRSxDQUFDO0lBQ25DLElBQUksR0FBZ0UsRUFBRSxDQUFDO0lBQ3ZFLG9CQUFvQixHQUF3QixFQUFFLENBQUM7SUFDL0MsMEJBQTBCLEdBQWEsRUFBRSxDQUFDO0lBQzFDLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFrRCxDQUFDO0lBQzdFLGlCQUFpQixDQUEwQjtJQUMzQyxrQkFBa0IsR0FBcUMsRUFBRSxDQUFDO0lBQzFELGFBQWEsQ0FBMEI7SUFDdkMsWUFBWSxHQUFpQyxFQUFFLENBQUM7SUFDaEQsTUFBTSxDQUFDLFFBQVEsQ0FBTztJQUV0QixNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQWtCLENBQUM7SUFDbkMsTUFBTSxHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO0lBQ25DLE9BQU8sR0FBRyxJQUFJLEdBQUcsRUFBdUIsQ0FBQztJQUN6QyxVQUFVLEdBQUcsSUFBSSxHQUFHLEVBQXlCLENBQUM7SUFFckMsc0JBQXNCLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQztJQUMzQyx5QkFBeUIsR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQyxDQUFDLHNCQUFzQjtJQUU3RSxlQUFlLEdBQXdDLElBQUksR0FBRyxFQUFFLENBQUM7SUFDakUsaUJBQWlCLEdBQTRDLElBQUksR0FBRyxFQUFFLENBQUM7SUFFeEYsZ0JBQXdCLENBQUMsQ0FBQywrQ0FBK0M7SUFFekUsTUFBTSxDQUFDLFdBQVc7UUFDZCxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2pCLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUMvQixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDO0lBQ3pCLENBQUM7SUFFRCxNQUFNLENBQUMsR0FBUTtRQUNYLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDO0lBQ25CLENBQUM7SUFFRCxNQUFNO1FBQ0YsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDO0lBQ3BCLENBQUM7SUFFRCxTQUFTLENBQUMsTUFBMEI7UUFDaEMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFDckIsdURBQXVEO1FBQ3ZELGVBQU0sQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ2xDLG1CQUFtQjtRQUNuQixJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxJQUFLLENBQUM7SUFDaEMsQ0FBQztJQUVELFNBQVM7UUFDTCxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDdkIsQ0FBQztJQUVELGlCQUFpQjtRQUNiLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxjQUFjLElBQUksZ0JBQVcsQ0FBQyxJQUFJLENBQUM7SUFDMUQsQ0FBQztJQUVELHNCQUFzQjtRQUNsQixJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztZQUNsQyxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsbUJBQW1CLENBQUM7UUFDM0MsQ0FBQztRQUVELGdFQUFnRTtRQUNoRSxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLHlCQUF5QixDQUFDLE9BQU8sRUFBRSxDQUFDO2FBQ3RELElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBRSxtQkFBbUI7YUFDaEQsR0FBRyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsRUFBRSxFQUFFLENBQUMsV0FBVyxDQUFDLENBQUM7SUFDN0MsQ0FBQztJQUVELDJCQUEyQixDQUFDLFdBQW1CLEVBQUUsV0FBbUIsR0FBRztRQUNuRSxJQUFJLENBQUMseUJBQXlCLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxRQUFRLENBQUMsQ0FBQztJQUM5RCxDQUFDO0lBRUQsMkJBQTJCLENBQUMsV0FBbUI7UUFDM0MsT0FBTyxJQUFJLENBQUMseUJBQXlCLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQzNELENBQUM7SUFFRCw4QkFBOEIsQ0FBQyxXQUFtQjtRQUM5QyxJQUFJLENBQUMseUJBQXlCLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQ3ZELENBQUM7SUFFRCx5QkFBeUI7UUFDckIsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUM7SUFDdkMsQ0FBQztJQUVELHlCQUF5QixDQUFDLFNBQWlCO1FBQ3ZDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDL0MsQ0FBQztJQUVELHlCQUF5QixDQUFDLFNBQWlCO1FBQ3ZDLE9BQU8sSUFBSSxDQUFDLHNCQUFzQixDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUN0RCxDQUFDO0lBRUQsNEJBQTRCLENBQUMsU0FBaUI7UUFDMUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNsRCxDQUFDO0lBRUQsUUFBUSxDQUFDLElBQVksRUFBRSxLQUFVO1FBQzdCLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFDekMsSUFBSSxDQUFDLE1BQU0sQ0FBRSxJQUFJLENBQUUsR0FBRyxLQUFLLENBQUM7UUFDNUIsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUdEOzs7Ozs7T0FNRztJQUNILFFBQVEsQ0FBQyxJQUFhLEVBQUUsZUFBd0I7UUFDNUMsSUFBSSxTQUFTLEdBQVcsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1FBQ2pFLHNHQUFzRztRQUN0RyxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxJQUFJLGVBQWUsRUFBRSxDQUFDO1lBQzVDLE1BQU0sSUFBSSxLQUFLLENBQUMsOEhBQThILENBQUMsQ0FBQztRQUNwSixDQUFDO1FBQ0QsMkhBQTJIO1FBQzNILElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBRSxTQUFTLENBQUUsS0FBSyxTQUFTLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxJQUFJLGVBQWUsQ0FBQyxFQUFFLENBQUM7WUFDekYsU0FBUyxHQUFHLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1FBQzNDLENBQUM7UUFDRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQywwQkFBMEIsRUFBRSxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDN0QsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFFLFNBQVMsQ0FBRSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3pDLElBQUksZUFBZSxFQUFFLENBQUM7Z0JBQ2xCLDRCQUE0QjtnQkFDNUIsSUFBSSxDQUFDLE1BQU0sQ0FBRSxTQUFTLENBQUUsR0FBRyxJQUFJLHlCQUFXLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsRUFBRSxTQUFTLENBQUMsQ0FBQztnQkFDdEYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsdUJBQXVCLEVBQUUsRUFBRSxTQUFTLEVBQUUsZUFBZSxFQUFFLENBQUMsQ0FBQztZQUMvRSxDQUFDO2lCQUFNLENBQUM7Z0JBQ0osSUFBSSxPQUFPLEdBQUcsR0FBRyxJQUFJLENBQUMsT0FBTyxJQUFJLFNBQVMsUUFBUSxDQUFDO2dCQUNuRCw4Q0FBOEM7Z0JBQzlDLElBQUksU0FBUyxLQUFLLGVBQWUsRUFBRSxDQUFDO29CQUNoQyxPQUFPLEdBQUcsR0FBRyxJQUFJLENBQUMsT0FBTyxRQUFRLENBQUM7Z0JBQ3RDLENBQUM7Z0JBQ0QscUJBQXFCO2dCQUNyQixJQUFJLENBQUMsTUFBTSxDQUFFLFNBQVMsQ0FBRSxHQUFHLElBQUksbUJBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLE9BQU8sRUFBRTtvQkFDcEQsR0FBRyxFQUFFO3dCQUNELE9BQU8sRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU87d0JBQzVCLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU07cUJBQzdCO2lCQUNKLENBQUMsQ0FBQztnQkFDSCwrQ0FBK0M7Z0JBQy9DLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQztnQkFDN0QsSUFBSSxVQUFVLEVBQUUsQ0FBQztvQkFDYixJQUFJLENBQUMsTUFBTSxDQUFFLFNBQVMsQ0FBRSxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsQ0FBQztnQkFDdkQsQ0FBQztnQkFDRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7WUFDdkQsQ0FBQztRQUNMLENBQUM7UUFDRCxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUUsU0FBUyxDQUFFLENBQUM7SUFDcEMsQ0FBQztJQUVELG1CQUFtQjtRQUNmLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsSUFBSSxNQUFNLENBQUM7SUFDbEQsQ0FBQztJQUVELGtCQUFrQixHQUFHLENBQUMsZ0JBQXlCLEVBQUUsYUFBcUIsRUFBVyxFQUFFO1FBQy9FLE9BQU8sQ0FDSCxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsVUFBVTtlQUN4QixJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsVUFBVSxLQUFLLElBQUk7ZUFDcEM7WUFDQywrRUFBK0U7WUFDL0UsQ0FBQyxhQUFhO2dCQUNkLDhGQUE4RjtnQkFDOUYsQ0FBQyxDQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsUUFBUSxDQUFDLGdCQUFnQixHQUFHLFFBQVEsQ0FBQyxJQUFJLGFBQWEsRUFBRSxTQUFTLEtBQUssZ0JBQWdCLENBQUMsQ0FDckgsQ0FDSixJQUFJLEtBQUssQ0FBQztJQUNmLENBQUMsQ0FBQTtJQUVELE1BQU0sQ0FBQyxnQkFBd0IsRUFBRSxJQUFZLEVBQUUsR0FBUSxFQUFFLGFBQXNCLEtBQUs7UUFDaEYsNkRBQTZEO1FBQzdELElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFFLGdCQUFnQixDQUFFLEVBQUUsQ0FBQztZQUNqQyxJQUFJLENBQUMsSUFBSSxDQUFFLGdCQUFnQixDQUFFLEdBQUcsRUFBRSxDQUFDO1FBQ3ZDLENBQUM7UUFDRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZDLElBQUksQ0FBQyxJQUFJLENBQUUsZ0JBQWdCLENBQUUsQ0FBRSxJQUFJLENBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxDQUFDO1FBQzdFLE9BQU8sSUFBSSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxNQUFNLENBQUMsZ0JBQXdCLEVBQUUsSUFBWTtRQUN6QyxtREFBbUQ7UUFDbkQsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUUsZ0JBQWdCLENBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUUsZ0JBQWdCLENBQUUsQ0FBRSxJQUFJLENBQUUsRUFBRSxDQUFDO1lBQzNFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLGlDQUFpQyxnQkFBZ0IsYUFBYSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1lBQ3hGLE9BQU8sU0FBUyxDQUFDO1FBQ3JCLENBQUM7UUFDRCxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUUsZ0JBQWdCLENBQUUsQ0FBRSxJQUFJLENBQUUsQ0FBQztJQUNqRCxDQUFDO0lBRUQsT0FBTyxDQUFDLGdCQUF3QjtRQUM1QixPQUFPLElBQUksQ0FBQyxJQUFJLENBQUUsZ0JBQWdCLENBQUUsQ0FBQztJQUN6QyxDQUFDO0lBRUQsY0FBYyxDQUFDLGdCQUF3QjtRQUNuQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBRSxnQkFBZ0IsQ0FBRSxFQUFFLENBQUM7WUFDakMsT0FBTyxLQUFLLENBQUM7UUFDakIsQ0FBQztRQUVELHNEQUFzRDtRQUN0RCxPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBRSxnQkFBZ0IsQ0FBRSxDQUFDO2FBQzlDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxVQUFVLEtBQUssSUFBSSxDQUFDLENBQUM7SUFDOUMsQ0FBQztJQUVELFNBQVMsQ0FBQyxJQUFZLEVBQUUsTUFBbUI7UUFDdkMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRXhFLGlEQUFpRDtRQUNqRCxLQUFLLE1BQU0sQ0FBRSxVQUFVLEVBQUUsTUFBTSxDQUFFLElBQUksTUFBTSxDQUFDLG1CQUFtQixFQUFFLEVBQUUsQ0FBQztZQUNoRSxJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsRUFBRSxNQUFNLEVBQUUsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUM7UUFDekQsQ0FBQztRQUVELHlEQUF5RDtRQUN6RCxLQUFLLE1BQU0sQ0FBRSxPQUFPLEVBQUUsUUFBUSxDQUFFLElBQUksTUFBTSxDQUFDLCtCQUErQixFQUFFLEVBQUUsQ0FBQztZQUMzRSxJQUFJLENBQUMsc0JBQXNCLENBQUMsT0FBTyxFQUFFLFFBQVEsRUFBRSxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQztRQUNyRSxDQUFDO1FBRUQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ25DLENBQUM7SUFFRCxVQUFVO1FBQ04sT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFBO0lBQ3ZCLENBQUM7SUFFRCxVQUFVO1FBQ04sT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksR0FBRyxDQUFDLENBQUM7SUFDakMsQ0FBQztJQUVELGFBQWEsQ0FBQyxJQUFZO1FBQ3RCLE9BQU8sR0FBRyxJQUFJLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLElBQUksS0FBSyxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDcEcsQ0FBQztJQUVELE1BQU0sQ0FBQyxJQUFZLEVBQUUsSUFBWTtRQUM3QixPQUFPLFdBQVcsSUFBSSxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxJQUFJLElBQUksRUFBRSxDQUFDO0lBQ2xGLENBQUM7SUFFRCxvQkFBb0IsQ0FBQyxJQUFZLEVBQUUsVUFBdUIsRUFBRSxvQkFBNkIsS0FBSztRQUMxRixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx3QkFBd0IsRUFBRSxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsVUFBVSxDQUFDLFlBQVksRUFBRSxpQkFBaUIsRUFBRSxDQUFDLENBQUM7UUFFOUcsSUFBSSxDQUFDLGtCQUFrQixDQUFFLElBQUksQ0FBRSxHQUFHLFVBQVUsQ0FBQztRQUM3QyxzRUFBc0U7UUFDdEUsSUFBSSxpQkFBaUIsS0FBSyxLQUFLLEVBQUUsQ0FBQztZQUM5QixJQUFJLENBQUMsaUJBQWlCLEdBQUcsVUFBVSxDQUFDO1FBQ3hDLENBQUM7SUFDTCxDQUFDO0lBRUQsb0JBQW9CLENBQUMsSUFBYTtRQUM5QixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFDckQsMEVBQTBFO1FBQzFFLElBQUksSUFBSSxLQUFLLFNBQVMsSUFBSSxJQUFJLENBQUMsaUJBQWlCLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDN0QsTUFBTSxJQUFJLEtBQUssQ0FBQyx1R0FBdUcsQ0FBQyxDQUFDO1FBQzdILENBQUM7UUFDRCx3REFBd0Q7UUFDeEQsSUFBSSxJQUFJLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDckIsT0FBTyxJQUFJLENBQUMsaUJBQWlCLENBQUM7UUFDbEMsQ0FBQztRQUNELHVEQUF1RDtRQUN2RCxJQUFJLElBQUksQ0FBQyxrQkFBa0IsQ0FBRSxJQUFJLENBQUUsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNoRCxNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixJQUFJLFlBQVksQ0FBQyxDQUFDO1FBQy9ELENBQUM7UUFDRCw4REFBOEQ7UUFDOUQsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUUsSUFBSSxDQUFFLENBQUM7SUFDM0MsQ0FBQztJQUVELGFBQWEsQ0FBQyxpQkFBeUIsRUFBRSxJQUFhO1FBQ2xELElBQUksaUJBQWlCLEtBQUssb0JBQW9CLEVBQUUsQ0FBQztZQUM3QyxPQUFPLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUMzQyxDQUFDO1FBQ0QsSUFBSSxpQkFBaUIsS0FBSyxLQUFLLEVBQUUsQ0FBQztZQUM5QixPQUFPLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1FBQ25DLENBQUM7UUFDRCxPQUFPLFNBQVMsQ0FBQztJQUNyQixDQUFDO0lBRUQsK0JBQStCLENBQUMsSUFBWTtRQUN4QyxJQUFJLENBQUMsc0JBQXNCLENBQUMsOEJBQThCLEVBQUUsSUFBSSxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQ2pGLENBQUM7SUFFRCwrQkFBK0I7UUFDM0IsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUMsOEJBQThCLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFDbEYsQ0FBQztJQUVELHNCQUFzQixDQUFDLElBQVksRUFBRSxLQUFVLEVBQUUsU0FBaUIsRUFBRTtRQUNoRSxJQUFJLENBQUMsb0JBQW9CLENBQUUsSUFBQSx3QkFBaUIsRUFBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUUsR0FBRyxLQUFLLENBQUM7SUFDekUsQ0FBQztJQUVELHNCQUFzQixDQUFDLElBQVksRUFBRSxTQUFpQixFQUFFLEVBQUUsS0FBVztRQUNqRSxvRkFBb0Y7UUFDcEYsbUZBQW1GO1FBQ25GLHNHQUFzRztRQUV0RyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLEtBQUssSUFBSSxLQUFLLFlBQVksbUJBQUssSUFBSSxJQUFJLENBQUMsa0JBQWtCLEVBQUUsRUFBRSxDQUFDO1lBQ3BGLE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxzQkFBVSxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUUsQ0FBQyxDQUFnQixDQUFDLENBQUM7WUFDcEcsSUFBSSxrQkFBa0IsRUFBRSxDQUFDO2dCQUNyQixvQ0FBb0M7Z0JBQ3BDLDBFQUEwRTtnQkFDMUUsNElBQTRJO2dCQUM1SSxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDL0MsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsSUFBSSx1RkFBdUYsQ0FBQyxDQUFDO2dCQUN6SSxDQUFDO2dCQUNELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBRSxJQUFBLHdCQUFpQixFQUFDLElBQUksRUFBRSxPQUFPLE1BQU0sRUFBRSxDQUFDLENBQUUsQ0FBQztnQkFFckYsSUFBSSxNQUFNLEVBQUUsQ0FBQztvQkFDVCxNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFFLENBQUMsQ0FBRSxDQUFDO29CQUN6QyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQywwRUFBMEUsSUFBQSx3QkFBaUIsRUFBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLGNBQWMsU0FBUyx1QkFBdUIsS0FBSyxDQUFDLFNBQVMsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQztvQkFDM08sSUFBSSxJQUFJLENBQUMsa0JBQWtCLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxFQUFFLENBQUM7d0JBQzVDLDZCQUE2Qjt3QkFDN0IsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBRSxTQUFTLENBQUUsQ0FBQzt3QkFDN0MsSUFBSSxXQUFXLEVBQUUsQ0FBQzs0QkFDZCxLQUFLLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFDOzRCQUNqQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx5QkFBeUIsS0FBSyxDQUFDLFNBQVMsT0FBTyxTQUFTLGlCQUFpQixNQUFNLEVBQUUsQ0FBQyxDQUFDO3dCQUN6RyxDQUFDO3dCQUNELElBQUksQ0FBQzs0QkFDRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQywyQ0FBMkMsTUFBTSxFQUFFLENBQUMsQ0FBQzs0QkFDdkUsT0FBTyx5QkFBZSxDQUFDLHVCQUF1QixDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQzt3QkFDbEUsQ0FBQzt3QkFBQyxPQUFPLEtBQUssRUFBRSxDQUFDOzRCQUNiLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO3dCQUM3QixDQUFDO29CQUNMLENBQUM7Z0JBQ0wsQ0FBQztxQkFBTSxDQUFDO29CQUNKLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHNEQUFzRCxJQUFBLHdCQUFpQixFQUFDLElBQUksRUFBRSxPQUFPLE1BQU0sRUFBRSxDQUFDLDBCQUEwQixDQUFDLENBQUM7Z0JBQy9JLENBQUM7WUFDTCxDQUFDO1FBQ0wsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLG9CQUFvQixDQUFFLElBQUEsd0JBQWlCLEVBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFFLENBQUM7SUFDeEUsQ0FBQztJQUVELHNCQUFzQixDQUFDLElBQVksRUFBRSxTQUFpQixFQUFFO1FBQ3BELE9BQU8sQ0FBQyxJQUFBLHdCQUFpQixFQUFDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxJQUFJLENBQUMsb0JBQW9CLENBQUMsQ0FBQztJQUMxRSxDQUFDO0lBRUQsbUJBQW1CLEdBQUcsQ0FBQyxNQUEwQixFQUFFLEVBQUUsS0FBVyxFQUFFLEVBQUU7UUFDaEUsTUFBTSxRQUFRLEdBQVEsRUFBRSxDQUFDO1FBQ3pCLEtBQUssTUFBTSxTQUFTLElBQUksR0FBRyxFQUFFLENBQUM7WUFDMUIsTUFBTSxLQUFLLEdBQUcsU0FBUyxDQUFDLEtBQUssSUFBSSxJQUFJLENBQUMsc0JBQXNCLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxTQUFTLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ3RHLElBQUksS0FBSyxFQUFFLENBQUM7Z0JBQ1IsUUFBUSxDQUFFLFNBQVMsQ0FBQyxVQUFVLElBQUksU0FBUyxDQUFDLElBQUksQ0FBRSxHQUFHLEtBQUssQ0FBQztZQUMvRCxDQUFDO2lCQUFNLENBQUM7Z0JBQ0osSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsaUNBQWlDLFNBQVMsQ0FBQyxNQUFNLEtBQUssU0FBUyxDQUFDLElBQUksMENBQTBDLENBQUMsQ0FBQztZQUNySSxDQUFDO1FBQ0wsQ0FBQztRQUNELE9BQU8sUUFBUSxDQUFDO0lBQ3BCLENBQUMsQ0FBQTtJQUdEOzs7Ozs7T0FNRztJQUNILHdCQUF3QixHQUFHLENBQUMsV0FBbUIsRUFBRSxFQUFFO1FBQy9DLElBQUksV0FBVyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1lBQ2pDLGdGQUFnRjtZQUNoRixNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBRXJDLDJGQUEyRjtZQUMzRixXQUFXLEdBQUcsS0FBSyxDQUFDLE1BQU0sS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxLQUFLLENBQUUsQ0FBQyxDQUFFLEVBQUUsS0FBSyxDQUFFLENBQUMsQ0FBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxLQUFLLENBQUUsQ0FBQyxDQUFFLENBQUMsQ0FBQztRQUNySSxDQUFDO1FBQ0QsT0FBTyxXQUFXLENBQUM7SUFDdkIsQ0FBQyxDQUFBO0lBRUQ7Ozs7T0FJRztJQUNILDRCQUE0QixDQUFDLElBQVksRUFBRSxLQUFVO1FBQ2pELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLCtCQUErQixFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztRQUMvRCxJQUFJLENBQUMsc0JBQXNCLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUM3QyxJQUFJLENBQUMsMEJBQTBCLENBQUMsSUFBSSxDQUFDLElBQUEsd0JBQWlCLEVBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDdEUsQ0FBQztJQUVELDZCQUE2QjtRQUN6QixPQUFPLElBQUksQ0FBQywwQkFBMEIsQ0FBQztJQUMzQyxDQUFDO0lBRUQsU0FBUyxDQUFDLFVBQWtCLEVBQUUsS0FBNkMsRUFBRSxTQUFpQixFQUFFO1FBQzVGLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLFlBQVksRUFBRSxNQUFNLEVBQUUsVUFBVSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzNELElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsSUFBQSx3QkFBaUIsRUFBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDNUUsQ0FBQztJQUVELFNBQVMsQ0FBQyxVQUFrQixFQUFFLFNBQWlCLEVBQUU7UUFDN0MsT0FBTyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLElBQUEsd0JBQWlCLEVBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUM7SUFDNUUsQ0FBQztJQUVELFNBQVMsQ0FBQyxVQUFrQixFQUFFLFNBQWlCLEVBQUU7UUFDN0MsT0FBTyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLElBQUEsd0JBQWlCLEVBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUM7SUFDNUUsQ0FBQztJQUVELGdDQUFnQztJQUNoQywrSkFBK0o7SUFDL0osb0lBQW9JO0lBQ3BJLDZIQUE2SDtJQUM3SCxrQkFBa0IsQ0FBQyxTQUF3QixFQUFFLEdBQVcsRUFBRSxLQUFVLEVBQUUsVUFBdUIsRUFBRSxjQUF1QixFQUFFLGdCQUF5QjtRQUM3SSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsU0FBUyxDQUFDLElBQUksRUFBRSxFQUFFLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDaEYsSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUNiLFNBQVMsQ0FBQyxNQUFNLEdBQUc7Z0JBQ2YsR0FBRyxTQUFTLENBQUMsTUFBTTtnQkFDbkIsQ0FBRSxVQUFVLENBQUUsRUFBRTtvQkFDWixHQUFHLFNBQVMsQ0FBQyxNQUFNLEVBQUUsQ0FBRSxVQUFVLENBQUU7b0JBQ25DLENBQUUsR0FBRyxDQUFFLEVBQUUsS0FBSztpQkFDakI7YUFDSixDQUFBO1lBQ0QsSUFBSSxDQUFDLHNCQUFzQixDQUFDLEdBQUcsRUFBRSxLQUFLLEVBQUUsR0FBRyxTQUFTLENBQUMsSUFBSSxJQUFJLFVBQVUsRUFBRSxDQUFDLENBQUM7WUFDM0UsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsMkJBQTJCLEdBQUcsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLEdBQUcsU0FBUyxDQUFDLElBQUksSUFBSSxVQUFVLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFFbkcsNEVBQTRFO1lBQzVFLElBQUksV0FBVyxHQUFHLEtBQUssQ0FBQztZQUN4QixJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxjQUFjLEVBQUUsQ0FBQztnQkFDOUMsV0FBVyxHQUFHLEtBQUssQ0FBRSxjQUFjLENBQUUsQ0FBQztZQUMxQyxDQUFDO2lCQUFNLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLGNBQWMsS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDbkUsT0FBTztZQUNYLENBQUM7aUJBQU0sSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztnQkFDbkMsT0FBTztZQUNYLENBQUM7WUFFRCxpREFBaUQ7WUFDakQsTUFBTSxZQUFZLEdBQUcsSUFBQSx3QkFBaUIsRUFBQyxHQUFHLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxJQUFJLENBQUMsQ0FBQztZQUMxRCxNQUFNLFNBQVMsR0FBRyxHQUFHLFVBQVUsR0FBRyxZQUFZLEdBQUcsZ0JBQWdCLElBQUksY0FBYyxFQUFFLENBQUM7WUFDdEYsTUFBTSxlQUFlLEdBQUcsR0FBRyxTQUFTLENBQUMsU0FBUyxDQUFDLFNBQVMsSUFBSSxTQUFTLEVBQUUsQ0FBQztZQUV4RSxJQUFJLHVCQUFTLENBQUMsU0FBUyxDQUFDLFNBQVMsRUFBRSxTQUFTLEVBQUU7Z0JBQzFDLEtBQUssRUFBRSxXQUFXO2dCQUNsQixVQUFVLEVBQUUsZUFBZTthQUM5QixDQUFDLENBQUM7WUFFSCx3REFBd0Q7WUFDeEQsSUFBSSxDQUFDLHNCQUFzQixDQUFDLEdBQUcsR0FBRyxJQUFJLGdCQUFnQixJQUFJLGNBQWMsRUFBRSxFQUFFLFdBQVcsRUFBRSxVQUFVLENBQUMsQ0FBQztZQUNyRyxnREFBZ0Q7WUFDaEQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsdUJBQXVCLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUN0RSxJQUFJLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUM7Z0JBQzVCLE1BQU0sTUFBTSxHQUFHLElBQUksU0FBUyxDQUFDLFNBQVMsQ0FBQyxTQUFTLElBQUksVUFBVSxJQUFJLFlBQVksSUFBSSxnQkFBZ0IsSUFBSSxjQUFjLEVBQUUsQ0FBQztnQkFDdkgsaUZBQWlGO2dCQUNqRixJQUFJLENBQUMsc0JBQXNCLENBQUMsR0FBRyxHQUFHLElBQUksZ0JBQWdCLElBQUksY0FBYyxFQUFFLEVBQUUsTUFBTSxFQUFFLE9BQU8sVUFBVSxFQUFFLENBQUMsQ0FBQztnQkFDekcsSUFBSSx5QkFBZSxDQUFDLFNBQVMsQ0FBQyxTQUFTLEVBQUUsTUFBTSxVQUFVLEdBQUcsWUFBWSxHQUFHLGdCQUFnQixJQUFJLGNBQWMsRUFBRSxFQUFFO29CQUM3RyxhQUFhLEVBQUUsTUFBTTtvQkFDckIsV0FBVyxFQUFFLFdBQVc7aUJBQzNCLENBQUMsQ0FBQztZQUNQLENBQUM7UUFFTCxDQUFDO2FBQU0sQ0FBQztZQUNKLFNBQVMsQ0FBQyxNQUFNLEdBQUc7Z0JBQ2YsR0FBRyxTQUFTLENBQUMsTUFBTTtnQkFDbkIsQ0FBRSxHQUFHLENBQUUsRUFBRSxLQUFLO2FBQ2pCLENBQUE7WUFDRCxJQUFJLENBQUMsc0JBQXNCLENBQUMsR0FBRyxFQUFFLEtBQUssRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDNUQsQ0FBQztJQUNMLENBQUM7SUFFRCxjQUFjLENBQUMsSUFBWSxFQUFFLEtBQWM7UUFDdkMsSUFBSSxHQUFHLElBQUEsMkJBQW9CLEVBQUMsSUFBSSxDQUFDLENBQUM7UUFDbEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsaUJBQWlCLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQy9DLElBQUksQ0FBQyxZQUFZLENBQUUsSUFBSSxDQUFFLEdBQUcsS0FBSyxDQUFDO0lBQ3RDLENBQUM7SUFFRCxjQUFjLENBQUMsSUFBWTtRQUN2QixPQUFPLElBQUksQ0FBQyxZQUFZLENBQUUsSUFBQSwyQkFBb0IsRUFBQyxJQUFJLENBQUMsQ0FBRSxDQUFDO0lBQzNELENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxjQUFjLENBQUMsU0FBaUIsRUFBRSxLQUFXLEVBQUUsV0FBb0I7UUFDL0QsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFNBQVMsR0FBRyxZQUFZLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3ZGLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQzlDLE1BQU0sUUFBUSxHQUFHLFdBQVcsQ0FBQyxDQUFDLENBQUMsR0FBRyxXQUFXLElBQUksU0FBUyxRQUFRLENBQUMsQ0FBQyxDQUFDLEdBQUcsU0FBUyxRQUFRLENBQUM7UUFDMUYsT0FBTyxlQUFLLENBQUMsWUFBWSxDQUFDLEtBQUssSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQzVFLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxjQUFjLENBQUMsU0FBaUIsRUFBRSxLQUFXLEVBQUUsV0FBb0I7UUFDL0QsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFNBQVMsRUFBRSxXQUFXLENBQUMsQ0FBQztRQUMxRSxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxhQUFhLENBQUMsQ0FBQztRQUNuRCxNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDLEdBQUcsV0FBVyxJQUFJLFNBQVMsUUFBUSxDQUFDLENBQUMsQ0FBQyxHQUFHLFNBQVMsUUFBUSxDQUFDO1FBQzFGLE9BQU8sZUFBSyxDQUFDLFlBQVksQ0FBQyxLQUFLLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQztJQUM1RSxDQUFDO0lBRUQsb0JBQW9CLENBQUMsS0FBYSxFQUFFLE1BQWdCLEVBQUUsNEJBQXFDLEtBQUs7UUFDNUYsSUFBSSxDQUFDLE1BQU0sSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ2pDLE1BQU0sR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsUUFBUSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1lBQzFELElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDVixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxvQ0FBb0MsS0FBSyxpREFBaUQsQ0FBQyxDQUFDO2dCQUM3RyxNQUFNLEdBQUcsQ0FBRSxTQUFTLENBQUUsQ0FBQztZQUMzQixDQUFDO1FBQ0wsQ0FBQztRQUNELElBQUksdUJBQXVCLEdBQUcsS0FBSyxDQUFDO1FBQ3BDLEtBQUssTUFBTSxTQUFTLElBQUksTUFBTSxFQUFFLENBQUM7WUFDN0Isa0ZBQWtGO1lBQ2xGLElBQUkseUJBQXlCLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxRQUFRLEVBQUUsVUFBVSxHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFFBQVEsRUFBRSxVQUFVLEdBQUcsU0FBUyxDQUFDLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDbEwsU0FBUztZQUNiLENBQUM7WUFDRCxXQUFXO1lBQ1gsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsdUJBQXVCLEVBQUUsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztZQUNqRSxNQUFNLElBQUksR0FBUyxJQUFJLENBQUMsc0JBQXNCLENBQUMsTUFBTSxFQUFFLFVBQVUsR0FBRyxTQUFTLENBQUMsQ0FBQztZQUMvRSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7Z0JBQ1IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsNkJBQTZCLFNBQVMsb0NBQW9DLEtBQUssNEZBQTRGLFNBQVMsR0FBRyxDQUFDLENBQUM7Z0JBQzNNLE9BQU87WUFDWCxDQUFDO1lBQ0QsNERBQTREO1lBQzVELElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLHVCQUF1QixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7WUFDdEQsdUJBQXVCLEdBQUcsSUFBSSxDQUFDO1FBQ25DLENBQUM7UUFDRCxJQUFJLENBQUMsdUJBQXVCLEVBQUUsQ0FBQztZQUMzQixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxTQUFTLEtBQUssMEZBQTBGLENBQUMsQ0FBQztRQUNoSSxDQUFDO0lBQ0wsQ0FBQztJQUVELHVCQUF1QixDQUFDLEtBQWE7UUFDakMsNkJBQTZCO1FBQzdCLE1BQU0sU0FBUyxHQUFHLElBQUkseUJBQWUsQ0FBQztZQUNsQyxNQUFNLEVBQUUsZ0JBQU0sQ0FBQyxLQUFLO1lBQ3BCLE9BQU8sRUFBRSxDQUFFLG9CQUFvQixDQUFFO1lBQ2pDLFNBQVMsRUFBRSxDQUFFLGlDQUFpQyxLQUFLLEVBQUUsQ0FBRTtTQUMxRCxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsRUFBRSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7UUFFdEQsT0FBTyxTQUFTLENBQUM7SUFDckIsQ0FBQztJQUVNLGtCQUFrQixDQUFJLElBQWdCLEVBQUUsSUFBWTtRQUN2RCxpREFBaUQ7UUFDakQsS0FBSyxNQUFNLFNBQVMsSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7WUFDL0MsSUFBSSxTQUFTLENBQUMsTUFBTSxFQUFFLENBQUUsSUFBSSxDQUFFLEVBQUUsQ0FBRSxJQUFJLENBQUUsRUFBRSxDQUFDO2dCQUN2QyxPQUFPLFNBQVMsQ0FBQyxNQUFNLENBQUUsSUFBSSxDQUFFLENBQUUsSUFBSSxDQUFPLENBQUM7WUFDakQsQ0FBQztRQUNMLENBQUM7UUFDRCxPQUFPLFNBQVMsQ0FBQztJQUNyQixDQUFDO0lBRU0sWUFBWSxDQUFDLFNBQXdCO1FBQ3hDLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFDbkQsQ0FBQztJQUVNLE1BQU0sQ0FBQyxPQUFlO1FBQ3pCLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBTSxzQkFBVSxDQUFDLEdBQUcsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUNsRSxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDUCxNQUFNLElBQUksS0FBSyxDQUFDLE9BQU8sT0FBTyxZQUFZLENBQUMsQ0FBQztRQUNoRCxDQUFDO1FBQ0QsT0FBTyxHQUFHLENBQUM7SUFDZixDQUFDO0lBRU0sYUFBYSxDQUFDLFVBQWtCO1FBQ25DLHlDQUF5QztRQUN6QyxPQUFPLHdCQUFVLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxVQUFVLE9BQU8sRUFBRTtZQUN6RCxVQUFVO1NBQ2IsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVELGdCQUFnQixDQUFDLFVBQXVCLEVBQUUsb0JBQTZCLEtBQUs7UUFDeEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsb0JBQW9CLEVBQUUsRUFBRSxVQUFVLEVBQUUsVUFBVSxDQUFDLFlBQVksRUFBRSxDQUFDLENBQUM7UUFDakYsSUFBSSxDQUFDLGFBQWEsR0FBRyxVQUFVLENBQUM7UUFDaEMsSUFBSSxpQkFBaUIsRUFBRSxDQUFDO1lBQ3BCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxVQUFVLENBQUM7WUFDcEMsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLHdCQUF3QixHQUFHLEtBQUssQ0FBQztRQUN0RCxDQUFDO0lBQ0wsQ0FBQztJQUVELGdCQUFnQjtRQUNaLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQztJQUM5QixDQUFDO0lBRU0sd0JBQXdCLENBQUMsVUFBc0M7UUFDbEUsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLFVBQVUsQ0FBQyxDQUFDO0lBQzVELENBQUM7SUFDTSxtQkFBbUIsQ0FBQyxJQUFZO1FBQ25DLE9BQU8sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM1QyxDQUFDO0lBQ00sbUJBQW1CLENBQUMsSUFBWTtRQUNuQyxPQUFPLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDNUMsQ0FBQztJQUNNLG9CQUFvQjtRQUN2QixPQUFPLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDO0lBQzNDLENBQUM7SUFDTSxvQkFBb0I7UUFDdkIsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO0lBQ3ZELENBQUM7SUFFTSxLQUFLLENBQUMsc0JBQXNCLENBQUMsSUFBWSxFQUFFLE1BQThCO1FBQzVFLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztJQUMzQyxDQUFDO0lBQ00saUJBQWlCLENBQUMsSUFBWTtRQUNqQyxPQUFPLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzFDLENBQUM7SUFDTSxpQkFBaUIsQ0FBQyxJQUFZO1FBQ2pDLE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDMUMsQ0FBQztJQUNNLGtCQUFrQjtRQUNyQixPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO0lBQ3JELENBQUM7SUFDTSxrQkFBa0I7UUFDckIsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUM7SUFDekMsQ0FBQztDQUNKO0FBam1CRCxvQkFpbUJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSUF1dGhvcml6ZXIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyJztcbmltcG9ydCB7IFRhYmxlVjIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0IHsgRWZmZWN0LCBQb2xpY3lTdGF0ZW1lbnQsIHR5cGUgUG9saWN5U3RhdGVtZW50UHJvcHMsIHR5cGUgUm9sZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0IHR5cGUgeyBJVG9waWMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJztcbmltcG9ydCB7IFRvcGljIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgeyBJUXVldWUsIFF1ZXVlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNxcyc7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uL2RpJztcbmltcG9ydCB7IHR5cGUgSUxhbWJkYUVudkNvbmZpZyB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgSUFwcGxpY2F0aW9uQ29uZmlnLCBTeXN0ZW1Db250cm9sbGVyRGVmaW5pdGlvbiwgU3lzdGVtVUlQYWdlRGVmaW5pdGlvbiB9IGZyb20gJy4uL2ludGVyZmFjZXMvY29uZmlnJztcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIE91dHB1dFR5cGUgfSBmcm9tICcuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdCc7XG5pbXBvcnQgeyB0eXBlIElESUNvbnRhaW5lciB9IGZyb20gJy4uL2ludGVyZmFjZXMvZGknO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tICcuL2hlbHBlcic7XG5pbXBvcnQgeyB0eXBlIElGdzI0TW9kdWxlIH0gZnJvbSAnLi9ydW50aW1lL21vZHVsZSc7XG5pbXBvcnQgeyBlbnN1cmVOb1NwZWNpYWxDaGFycywgZW5zdXJlVmFsaWRFbnZLZXkgfSBmcm9tICcuLi91dGlscy9rZXlzJztcbmltcG9ydCB7IEFwcCwgQ2ZuT3V0cHV0LCBGbiwgTmVzdGVkU3RhY2ssIFN0YWNrIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgU3RyaW5nUGFyYW1ldGVyIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNzbSc7XG5pbXBvcnQgeyBWcGMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCB7IElIb3N0ZWRab25lLCBIb3N0ZWRab25lIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXJvdXRlNTMnO1xuXG5leHBvcnQgY2xhc3MgRncyNCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEZ3MjQubmFtZSk7XG5cbiAgICBhcHBOYW1lOiBzdHJpbmcgPSBcImZ3MjRcIjtcbiAgICBlbWFpbFByb3ZpZGVyOiBhbnk7XG5cbiAgICBwcml2YXRlIGNvbmZpZzogSUFwcGxpY2F0aW9uQ29uZmlnID0ge307XG4gICAgcHJpdmF0ZSBhcHAhOiBBcHA7XG4gICAgcHJpdmF0ZSBzdGFja3M6IFJlY29yZDxzdHJpbmcsIFN0YWNrPiA9IHt9O1xuICAgIHByaXZhdGUgYXBpczogeyBbIGFwaUNvbnN0cnVjdE5hbWU6IHN0cmluZyBdOiB7IFsgbmFtZTogc3RyaW5nIF06IGFueSB9IH0gPSB7fTtcbiAgICBwcml2YXRlIGVudmlyb25tZW50VmFyaWFibGVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgcHJpdmF0ZSBnbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlczogc3RyaW5nW10gPSBbXTtcbiAgICBwcml2YXRlIHBvbGljeVN0YXRlbWVudHMgPSBuZXcgTWFwPHN0cmluZywgUG9saWN5U3RhdGVtZW50UHJvcHMgfCBQb2xpY3lTdGF0ZW1lbnQ+KCk7XG4gICAgcHJpdmF0ZSBkZWZhdWx0QXV0aG9yaXplcjogSUF1dGhvcml6ZXIgfCB1bmRlZmluZWQ7XG4gICAgcHJpdmF0ZSBjb2duaXRvQXV0aG9yaXplcnM6IHsgWyBrZXk6IHN0cmluZyBdOiBJQXV0aG9yaXplciB9ID0ge307XG4gICAgcHJpdmF0ZSBqd3RBdXRob3JpemVyOiBJQXV0aG9yaXplciB8IHVuZGVmaW5lZDtcbiAgICBwcml2YXRlIGR5bmFtb1RhYmxlczogeyBbIGtleTogc3RyaW5nIF06IFRhYmxlVjIgfSA9IHt9O1xuICAgIHByaXZhdGUgc3RhdGljIGluc3RhbmNlOiBGdzI0O1xuXG4gICAgcHJpdmF0ZSBxdWV1ZXMgPSBuZXcgTWFwPHN0cmluZywgSVF1ZXVlPigpO1xuICAgIHByaXZhdGUgdG9waWNzID0gbmV3IE1hcDxzdHJpbmcsIElUb3BpYz4oKTtcbiAgICBwcml2YXRlIG1vZHVsZXMgPSBuZXcgTWFwPHN0cmluZywgSUZ3MjRNb2R1bGU+KCk7XG4gICAgcHJpdmF0ZSBjb25zdHJ1Y3RzID0gbmV3IE1hcDxzdHJpbmcsIEZXMjRDb25zdHJ1Y3Q+KCk7XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdsb2JhbExhbWJkYUxheWVyTmFtZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGdsb2JhbExhbWJkYUVudHJ5UGFja2FnZXMgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpOyAvLyBwYWNrYWdlIC0+IHByaW9yaXR5XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IHN5c3RlbVVJQ29uZmlnczogTWFwPHN0cmluZywgU3lzdGVtVUlQYWdlRGVmaW5pdGlvbj4gPSBuZXcgTWFwKCk7XG4gICAgcHJpdmF0ZSByZWFkb25seSBzeXN0ZW1Db250cm9sbGVyczogTWFwPHN0cmluZywgU3lzdGVtQ29udHJvbGxlckRlZmluaXRpb24+ID0gbmV3IE1hcCgpO1xuXG4gICAgcHJpdmF0ZSBjb25zdHJ1Y3RvcigpIHsgfSAvLyBFbXB0eSBjb25zdHJ1Y3RvciBhcyBBcHAgaXMgc2V0IHZpYSBzZXRBcHAoKVxuXG4gICAgc3RhdGljIGdldEluc3RhbmNlKCk6IEZ3MjQge1xuICAgICAgICBpZiAoIUZ3MjQuaW5zdGFuY2UpIHtcbiAgICAgICAgICAgIEZ3MjQuaW5zdGFuY2UgPSBuZXcgRncyNCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIEZ3MjQuaW5zdGFuY2U7XG4gICAgfVxuXG4gICAgc2V0QXBwKGFwcDogQXBwKSB7XG4gICAgICAgIHRoaXMuYXBwID0gYXBwO1xuICAgIH1cblxuICAgIGdldEFwcCgpOiBBcHAge1xuICAgICAgICByZXR1cm4gdGhpcy5hcHA7XG4gICAgfVxuXG4gICAgc2V0Q29uZmlnKGNvbmZpZzogSUFwcGxpY2F0aW9uQ29uZmlnKSB7XG4gICAgICAgIHRoaXMuY29uZmlnID0gY29uZmlnO1xuICAgICAgICAvLyBIeWRyYXRlIHRoZSBjb25maWcgb2JqZWN0IHdpdGggZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKHRoaXMuY29uZmlnKTtcbiAgICAgICAgLy8gU2V0IHRoZSBhcHAgbmFtZVxuICAgICAgICB0aGlzLmFwcE5hbWUgPSBjb25maWcubmFtZSE7XG4gICAgfVxuXG4gICAgZ2V0Q29uZmlnKCk6IElBcHBsaWNhdGlvbkNvbmZpZyB7XG4gICAgICAgIHJldHVybiB0aGlzLmNvbmZpZztcbiAgICB9XG5cbiAgICBnZXRBcHBESUNvbnRhaW5lcigpOiBJRElDb250YWluZXIge1xuICAgICAgICByZXR1cm4gdGhpcy5jb25maWcuYXBwRElDb250YWluZXIgfHwgRElDb250YWluZXIuUk9PVDtcbiAgICB9XG5cbiAgICBnZXRMYW1iZGFFbnRyeVBhY2thZ2VzKCk6IHN0cmluZ1tdIHtcbiAgICAgICAgaWYgKHRoaXMuY29uZmlnLmxhbWJkYUVudHJ5UGFja2FnZXMpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5sYW1iZGFFbnRyeVBhY2thZ2VzO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBTb3J0IGVudHJ5IHBhY2thZ2VzIGJ5IHByaW9yaXR5IChsb3dlciBudW1iZXIgPSBsb2FkZWQgZmlyc3QpXG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKHRoaXMuZ2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlcy5lbnRyaWVzKCkpXG4gICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gYVsxXSAtIGJbMV0pICAvLyBTb3J0IGJ5IHByaW9yaXR5XG4gICAgICAgICAgICAubWFwKChbcGFja2FnZU5hbWVdKSA9PiBwYWNrYWdlTmFtZSk7XG4gICAgfVxuXG4gICAgYWRkR2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlKHBhY2thZ2VOYW1lOiBzdHJpbmcsIHByaW9yaXR5OiBudW1iZXIgPSA5OTkpIHtcbiAgICAgICAgdGhpcy5nbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2VzLnNldChwYWNrYWdlTmFtZSwgcHJpb3JpdHkpO1xuICAgIH1cblxuICAgIGhhc0dsb2JhbExhbWJkYUVudHJ5UGFja2FnZShwYWNrYWdlTmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdsb2JhbExhbWJkYUVudHJ5UGFja2FnZXMuaGFzKHBhY2thZ2VOYW1lKTtcbiAgICB9XG5cbiAgICByZW1vdmVHbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2UocGFja2FnZU5hbWU6IHN0cmluZykge1xuICAgICAgICB0aGlzLmdsb2JhbExhbWJkYUVudHJ5UGFja2FnZXMuZGVsZXRlKHBhY2thZ2VOYW1lKTtcbiAgICB9XG5cbiAgICBnZXRHbG9iYWxMYW1iZGFMYXllck5hbWVzKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nbG9iYWxMYW1iZGFMYXllck5hbWVzO1xuICAgIH1cblxuICAgIGFkZEdsb2JhbExhbWJkYUxheWVyTmFtZXMobGF5ZXJOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5nbG9iYWxMYW1iZGFMYXllck5hbWVzLmFkZChsYXllck5hbWUpO1xuICAgIH1cblxuICAgIGhhc0dsb2JhbExhbWJkYUxheWVyTmFtZXMobGF5ZXJOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2xvYmFsTGFtYmRhTGF5ZXJOYW1lcy5oYXMobGF5ZXJOYW1lKTtcbiAgICB9XG5cbiAgICByZW1vdmVHbG9iYWxMYW1iZGFMYXllck5hbWVzKGxheWVyTmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuZ2xvYmFsTGFtYmRhTGF5ZXJOYW1lcy5kZWxldGUobGF5ZXJOYW1lKTtcbiAgICB9XG5cbiAgICBhZGRTdGFjayhuYW1lOiBzdHJpbmcsIHN0YWNrOiBhbnkpOiBGdzI0IHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhZGRTdGFjazpcIiwgeyBuYW1lIH0pO1xuICAgICAgICB0aGlzLnN0YWNrc1sgbmFtZSBdID0gc3RhY2s7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogR2V0IGEgc3RhY2sgYnkgbmFtZS4gSWYgdGhlIHN0YWNrIGRvZXMgbm90IGV4aXN0LCBjcmVhdGUgaXQuXG4gICAgICogXG4gICAgICogQHBhcmFtIG5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgc3RhY2sgdG8gZ2V0LlxuICAgICAqIEBwYXJhbSBwYXJlbnRTdGFja05hbWUgLSBUaGUgbmFtZSBvZiB0aGUgcGFyZW50IHN0YWNrLlxuICAgICAqIEByZXR1cm5zIFRoZSBzdGFjay5cbiAgICAgKi9cbiAgICBnZXRTdGFjayhuYW1lPzogc3RyaW5nLCBwYXJlbnRTdGFja05hbWU/OiBzdHJpbmcpOiBhbnkge1xuICAgICAgICBsZXQgc3RhY2tOYW1lOiBzdHJpbmcgPSBuYW1lID8gbmFtZSA6IHRoaXMuZ2V0RGVmYXVsdFN0YWNrTmFtZSgpO1xuICAgICAgICAvLyBkb24ndCBhbGxvdyBuZXN0ZWQgc3RhY2tzIGlmIG11bHRpU3RhY2sgaXMgdHJ1ZSwgbXVsdGlzdGFjayBpcyB1c2VkIGZvciBjcmVhdGluZyBpbmRlcGVuZGVudCBzdGFja3NcbiAgICAgICAgaWYgKHRoaXMuY29uZmlnLm11bHRpU3RhY2sgJiYgcGFyZW50U3RhY2tOYW1lKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05lc3RlZCBzdGFja3MgYXJlIG5vdCBhbGxvd2VkIHdoZW4gbXVsdGlTdGFjayBpcyB0cnVlLiBQbGVhc2UgdXNlIG11bHRpU3RhY2s6IGZhbHNlIG9yIHJlbW92ZSB0aGUgcGFyZW50U3RhY2tOYW1lIHBhcmFtZXRlci4nKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBpZiB0aGUgc3RhY2sgZG9lcyBub3QgZXhpc3QgYW5kIG11bHRpU3RhY2sgaXMgZmFsc2UgYW5kIHBhcmVudFN0YWNrTmFtZSBpcyBub3QgcHJvdmlkZWQsIHRoZW4gdXNlIHRoZSBkZWZhdWx0IHN0YWNrIG5hbWVcbiAgICAgICAgaWYgKHRoaXMuc3RhY2tzWyBzdGFja05hbWUgXSA9PT0gdW5kZWZpbmVkICYmICEodGhpcy5jb25maWcubXVsdGlTdGFjayB8fCBwYXJlbnRTdGFja05hbWUpKSB7XG4gICAgICAgICAgICBzdGFja05hbWUgPSB0aGlzLmdldERlZmF1bHRTdGFja05hbWUoKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkdldHRpbmcgU3RhY2sgV2l0aCBOYW1lOlwiLCB7IHN0YWNrTmFtZSB9KTtcbiAgICAgICAgaWYgKHRoaXMuc3RhY2tzWyBzdGFja05hbWUgXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBpZiAocGFyZW50U3RhY2tOYW1lKSB7XG4gICAgICAgICAgICAgICAgLy8gY3JlYXRlIGEgbmV3IG5lc3RlZCBzdGFja1xuICAgICAgICAgICAgICAgIHRoaXMuc3RhY2tzWyBzdGFja05hbWUgXSA9IG5ldyBOZXN0ZWRTdGFjayh0aGlzLmdldFN0YWNrKHBhcmVudFN0YWNrTmFtZSksIHN0YWNrTmFtZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGVkIG5lc3RlZCBzdGFjazpcIiwgeyBzdGFja05hbWUsIHBhcmVudFN0YWNrTmFtZSB9KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbGV0IHN0YWNrSUQgPSBgJHt0aGlzLmFwcE5hbWV9LSR7c3RhY2tOYW1lfS1zdGFja2A7XG4gICAgICAgICAgICAgICAgLy8gYmFja3dhcmRzIGNvbXBhdGliaWxpdHkgZm9yIG9sZCBzdGFjayBuYW1lc1xuICAgICAgICAgICAgICAgIGlmIChzdGFja05hbWUgPT09ICdwcmVtdWx0aXN0YWNrJykge1xuICAgICAgICAgICAgICAgICAgICBzdGFja0lEID0gYCR7dGhpcy5hcHBOYW1lfS1zdGFja2A7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIGNyZWF0ZSBhIG5ldyBzdGFja1xuICAgICAgICAgICAgICAgIHRoaXMuc3RhY2tzWyBzdGFja05hbWUgXSA9IG5ldyBTdGFjayh0aGlzLmFwcCwgc3RhY2tJRCwge1xuICAgICAgICAgICAgICAgICAgICBlbnY6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjY291bnQ6IHRoaXMuY29uZmlnLmFjY291bnQsXG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpb246IHRoaXMuY29uZmlnLnJlZ2lvblxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgLy8gbWFrZSBhbGwgc3RhY2tzIGRlcGVuZGVudCBvbiB0aGUgbGF5ZXIgc3RhY2tcbiAgICAgICAgICAgICAgICBjb25zdCBsYXllclN0YWNrID0gdGhpcy5nZXRTdGFjayh0aGlzLmNvbmZpZy5sYXllclN0YWNrTmFtZSk7XG4gICAgICAgICAgICAgICAgaWYgKGxheWVyU3RhY2spIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdLmFkZERlcGVuZGVuY3kobGF5ZXJTdGFjayk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ3JlYXRlZCBzdGFjazpcIiwgeyBzdGFja05hbWUgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhY2tzWyBzdGFja05hbWUgXTtcbiAgICB9XG5cbiAgICBnZXREZWZhdWx0U3RhY2tOYW1lKCk6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kZWZhdWx0U3RhY2tOYW1lIHx8ICdtYWluJztcbiAgICB9XG5cbiAgICB1c2VNdWx0aVN0YWNrU2V0dXAgPSAoY3VycmVudFN0YWNrTmFtZT86IHN0cmluZywgcmVzb3VyY2VTdGFjaz86IFN0YWNrKTogYm9vbGVhbiA9PiB7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICB0aGlzLmdldENvbmZpZygpLm11bHRpU3RhY2tcbiAgICAgICAgICAgICYmIHRoaXMuZ2V0Q29uZmlnKCkubXVsdGlTdGFjayA9PT0gdHJ1ZVxuICAgICAgICAgICAgJiYgKFxuICAgICAgICAgICAgICAgIC8vIGlmIHJlc291cmNlIHN0YWNrIGlzIG5vdCBwcm92aWRlZCwgdGhlbiBvbmx5IGNoZWNrIGlmIG11bHRpLXN0YWNrIGlzIGVuYWJsZWRcbiAgICAgICAgICAgICAgICAhcmVzb3VyY2VTdGFjayB8fFxuICAgICAgICAgICAgICAgIC8vIGlmIHJlc291cmNlIHN0YWNrIGlzIHByb3ZpZGVkLCB0aGVuIGNoZWNrIGlmIGl0IGlzIGEgZGlmZmVyZW50IHN0YWNrIHRoYW4gdGhlIGN1cnJlbnQgc3RhY2tcbiAgICAgICAgICAgICAgICAhKHJlc291cmNlU3RhY2s/LnN0YWNrTmFtZS5lbmRzV2l0aChjdXJyZW50U3RhY2tOYW1lICsgJy1zdGFjaycpIHx8IHJlc291cmNlU3RhY2s/LnN0YWNrTmFtZSA9PT0gY3VycmVudFN0YWNrTmFtZSlcbiAgICAgICAgICAgIClcbiAgICAgICAgKSB8fCBmYWxzZTtcbiAgICB9XG5cbiAgICBhZGRBUEkoYXBpQ29uc3RydWN0TmFtZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcsIGFwaTogYW55LCBpc0ltcG9ydGVkOiBib29sZWFuID0gZmFsc2UpOiBGdzI0IHtcbiAgICAgICAgLy8gSW5pdGlhbGl6ZSB0aGUgYXBpQ29uc3RydWN0TmFtZSBvYmplY3QgaWYgaXQgZG9lc24ndCBleGlzdFxuICAgICAgICBpZiAoIXRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdKSB7XG4gICAgICAgICAgICB0aGlzLmFwaXNbIGFwaUNvbnN0cnVjdE5hbWUgXSA9IHt9O1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiYWRkQVBJOlwiLCB7IG5hbWUgfSk7XG4gICAgICAgIHRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdWyBuYW1lIF0gPSB7IGFwaTogYXBpLCBpc0ltcG9ydGVkOiBpc0ltcG9ydGVkIH07XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGdldEFQSShhcGlDb25zdHJ1Y3ROYW1lOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IGFueSB7XG4gICAgICAgIC8vIENoZWNrIGlmIEFQSSBleGlzdHMgZm9yIHRoZSBnaXZlbiBuYW1lIGFuZCBzdGFja1xuICAgICAgICBpZiAoIXRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdIHx8ICF0aGlzLmFwaXNbIGFwaUNvbnN0cnVjdE5hbWUgXVsgbmFtZSBdKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQVBJIG5vdCBmb3VuZDogY29uc3RydWN0IG5hbWUgJHthcGlDb25zdHJ1Y3ROYW1lfSBhbmQgbmFtZSAke25hbWV9YCk7XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmFwaXNbIGFwaUNvbnN0cnVjdE5hbWUgXVsgbmFtZSBdO1xuICAgIH1cblxuICAgIGdldEFQSXMoYXBpQ29uc3RydWN0TmFtZTogc3RyaW5nKTogYW55IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdO1xuICAgIH1cblxuICAgIGhhc0ltcG9ydGVkQVBJKGFwaUNvbnN0cnVjdE5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgICAgICBpZiAoIXRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiBhbnkgQVBJIGluIGFueSBzdGFjayBpcyBtYXJrZWQgYXMgaW1wb3J0ZWRcbiAgICAgICAgcmV0dXJuIE9iamVjdC52YWx1ZXModGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF0pXG4gICAgICAgICAgICAuc29tZShhcGkgPT4gYXBpLmlzSW1wb3J0ZWQgPT09IHRydWUpO1xuICAgIH1cblxuICAgIGFkZE1vZHVsZShuYW1lOiBzdHJpbmcsIG1vZHVsZTogSUZ3MjRNb2R1bGUpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhZGRNb2R1bGU6XCIsIHsgbmFtZSwgbW9kdWxlOiBtb2R1bGUuZ2V0QmFzZVBhdGgoKSB9KTtcblxuICAgICAgICAvLyBjb2xsZWN0IGFsbCBleHBvcnRlZCBwb2xpY2llcyBmcm9tIHRoaXMgbW9kdWxlXG4gICAgICAgIGZvciAoY29uc3QgWyBwb2xpY3lOYW1lLCBwb2xpY3kgXSBvZiBtb2R1bGUuZ2V0RXhwb3J0ZWRQb2xpY2llcygpKSB7XG4gICAgICAgICAgICB0aGlzLnNldFBvbGljeShwb2xpY3lOYW1lLCBwb2xpY3ksIG1vZHVsZS5nZXROYW1lKCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gYWRkIGFsbCBleHBvcnRlZCBzdGF0aWMgZW52IHZhbHVlcyBpbnRvIHRoZSBGVzI0IHNjb3BlXG4gICAgICAgIGZvciAoY29uc3QgWyBlbnZOYW1lLCBlbnZWYWx1ZSBdIG9mIG1vZHVsZS5nZXRFeHBvcnRlZEVudmlyb25tZW50VmFyaWFibGVzKCkpIHtcbiAgICAgICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShlbnZOYW1lLCBlbnZWYWx1ZSwgbW9kdWxlLmdldE5hbWUoKSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLm1vZHVsZXMuc2V0KG5hbWUsIG1vZHVsZSk7XG4gICAgfVxuXG4gICAgZ2V0TW9kdWxlcygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubW9kdWxlc1xuICAgIH1cblxuICAgIGhhc01vZHVsZXMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm1vZHVsZXMuc2l6ZSA+IDA7XG4gICAgfVxuXG4gICAgZ2V0VW5pcXVlTmFtZShuYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIGAke25hbWV9LSR7dGhpcy5jb25maWcubmFtZX0tJHt0aGlzLmNvbmZpZy5lbnZpcm9ubWVudCB8fCAnZW52J30tJHt0aGlzLmNvbmZpZy5hY2NvdW50fWA7XG4gICAgfVxuXG4gICAgZ2V0QXJuKHR5cGU6IHN0cmluZywgbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIGBhcm46YXdzOiR7dHlwZX06JHt0aGlzLmNvbmZpZy5yZWdpb259OiR7dGhpcy5jb25maWcuYWNjb3VudH06JHtuYW1lfWA7XG4gICAgfVxuXG4gICAgc2V0Q29nbml0b0F1dGhvcml6ZXIobmFtZTogc3RyaW5nLCBhdXRob3JpemVyOiBJQXV0aG9yaXplciwgZGVmYXVsdEF1dGhvcml6ZXI6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcInNldENvZ25pdG9BdXRob3JpemVyOiBcIiwgeyBuYW1lLCBhdXRob3JpemVyOiBhdXRob3JpemVyLmF1dGhvcml6ZXJJZCwgZGVmYXVsdEF1dGhvcml6ZXIgfSk7XG5cbiAgICAgICAgdGhpcy5jb2duaXRvQXV0aG9yaXplcnNbIG5hbWUgXSA9IGF1dGhvcml6ZXI7XG4gICAgICAgIC8vIElmIHRoaXMgYXV0aG9yaXplciBpcyB0aGUgZGVmYXVsdCwgc2V0IGl0IGFzIHRoZSBkZWZhdWx0IGF1dGhvcml6ZXJcbiAgICAgICAgaWYgKGRlZmF1bHRBdXRob3JpemVyICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgdGhpcy5kZWZhdWx0QXV0aG9yaXplciA9IGF1dGhvcml6ZXI7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRDb2duaXRvQXV0aG9yaXplcihuYW1lPzogc3RyaW5nKTogSUF1dGhvcml6ZXIgfCB1bmRlZmluZWQge1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiZ2V0Q29nbml0b0F1dGhvcml6ZXI6IFwiLCB7IG5hbWUgfSk7XG4gICAgICAgIC8vIElmIG5vIG5hbWUgaXMgcHJvdmlkZWQgYW5kIG5vIGRlZmF1bHQgYXV0aG9yaXplciBpcyBzZXQsIHRocm93IGFuIGVycm9yXG4gICAgICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQgJiYgdGhpcy5kZWZhdWx0QXV0aG9yaXplciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIEF1dGhvcml6ZXIgZXhpc3RzIGZvciBjb2duaXRvIHVzZXIgcG9vbHMuIEZvciBwb2xpY3kgYmFzZWQgYXV0aGVudGljYXRpb24sIHVzZSBBV1NfSUFNIGF1dGhvcmlzZXIuJyk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gSWYgbm8gbmFtZSBpcyBwcm92aWRlZCwgcmV0dXJuIHRoZSBkZWZhdWx0IGF1dGhvcml6ZXJcbiAgICAgICAgaWYgKG5hbWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGVmYXVsdEF1dGhvcml6ZXI7XG4gICAgICAgIH1cbiAgICAgICAgLy8gaWYgYXV0aG9yaXplciB3aXRoIG5hbWUgaXMgbm90IGZvdW5kLCB0aHJvdyBhbiBlcnJvclxuICAgICAgICBpZiAodGhpcy5jb2duaXRvQXV0aG9yaXplcnNbIG5hbWUgXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF1dGhvcml6ZXIgd2l0aCBuYW1lOiAke25hbWV9IG5vdCBmb3VuZGApO1xuICAgICAgICB9XG4gICAgICAgIC8vIElmIGEgbmFtZSBpcyBwcm92aWRlZCwgcmV0dXJuIHRoZSBhdXRob3JpemVyIHdpdGggdGhhdCBuYW1lXG4gICAgICAgIHJldHVybiB0aGlzLmNvZ25pdG9BdXRob3JpemVyc1sgbmFtZSBdO1xuICAgIH1cblxuICAgIGdldEF1dGhvcml6ZXIoYXV0aG9yaXphdGlvblR5cGU6IHN0cmluZywgbmFtZT86IHN0cmluZyk6IElBdXRob3JpemVyIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgaWYgKGF1dGhvcml6YXRpb25UeXBlID09PSBcIkNPR05JVE9fVVNFUl9QT09MU1wiKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRDb2duaXRvQXV0aG9yaXplcihuYW1lKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYXV0aG9yaXphdGlvblR5cGUgPT09IFwiSldUXCIpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmdldEp3dEF1dGhvcml6ZXIoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHNldERlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUobmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnZGVmYXVsdENvZ25pdG9BdXRob3JpemVyTmFtZScsIG5hbWUsICdjb2duaXRvJyk7XG4gICAgfVxuXG4gICAgZ2V0RGVmYXVsdENvZ25pdG9BdXRob3JpemVyTmFtZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnZGVmYXVsdENvZ25pdG9BdXRob3JpemVyTmFtZScsICdjb2duaXRvJyk7XG4gICAgfVxuXG4gICAgc2V0RW52aXJvbm1lbnRWYXJpYWJsZShuYW1lOiBzdHJpbmcsIHZhbHVlOiBhbnksIHByZWZpeDogc3RyaW5nID0gJycpIHtcbiAgICAgICAgdGhpcy5lbnZpcm9ubWVudFZhcmlhYmxlc1sgZW5zdXJlVmFsaWRFbnZLZXkobmFtZSwgcHJlZml4KSBdID0gdmFsdWU7XG4gICAgfVxuXG4gICAgZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShuYW1lOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nID0gJycsIHNjb3BlPzogYW55KTogYW55IHtcbiAgICAgICAgLy8gaWYgbG9va3VwIGlzIGZvciBjb25zdHJ1Y3Qgb3V0cHV0IChiYXNlZCBvbiBwcmVmaXggYmVpbmcgb25lIG9mIHRoZSBvdXRwdXQgdHlwZXMpXG4gICAgICAgIC8vIGFuZCB0aGUgYXBwbGljYXRpb24gaGFzIG11bHRpcGxlIHN0YWNrcywgdGhlbiBsb29rIGZvciB2YWx1ZSBpbiB0aGUgc3RhY2sgZXhwb3J0XG4gICAgICAgIC8vIGlmIHRoZSBzY29wZSBpcyBkZWZpbmVkIGFuZCBpcyBhIHN0YWNrIGFuZCB0aGUgb3V0cHV0IGlzIGZyb20gdGhlIHNhbWUgc3RhY2ssIHRoZW4gcmV0dXJuIHRoZSB2YWx1ZVxuXG4gICAgICAgIGlmIChwcmVmaXgubGVuZ3RoID4gMCAmJiBzY29wZSAmJiBzY29wZSBpbnN0YW5jZW9mIFN0YWNrICYmIHRoaXMudXNlTXVsdGlTdGFja1NldHVwKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGlzUHJlZml4T3V0cHV0VHlwZSA9IE9iamVjdC52YWx1ZXMoT3V0cHV0VHlwZSkuaW5jbHVkZXMocHJlZml4LnNwbGl0KCdfJylbIDAgXSBhcyBPdXRwdXRUeXBlKTtcbiAgICAgICAgICAgIGlmIChpc1ByZWZpeE91dHB1dFR5cGUpIHtcbiAgICAgICAgICAgICAgICAvLyBDaGVjayBmb3IgU1NNIHBhcmFtZXRlciByZWZlcmVuY2VcbiAgICAgICAgICAgICAgICAvLyBtYWtlIHN1cmUgdGhlIGtleSBpcyBzcGVjaWZpZWQgYXMgcXVhbGlmaWVkIGtleSBpLmUuIGtleV9leHBvcnRWYWx1ZUtleVxuICAgICAgICAgICAgICAgIC8vIGl0IGlzIHBvc3NpYmxlIHRoYXQgdGhlIGtleSBpcyBub3QgcXVhbGlmaWVkIGlmIHRoZSBwcmVmaXggaGFzIG91dHB1dCB0eXBlIGFuZCBrZXkgbmFtZS4gaWUuIHByZWZpeDogdXNlcnBvb2xfYXV0aG1vZHVsZSwga2V5OiB1c2VyUG9vbElkXG4gICAgICAgICAgICAgICAgaWYgKCFuYW1lLmluY2x1ZGVzKCdfJykgJiYgIXByZWZpeC5pbmNsdWRlcygnXycpKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRW52aXJvbm1lbnQgdmFyaWFibGUgJHtuYW1lfSBpcyBub3QgYSBxdWFsaWZpZWQga2V5LiBQbGVhc2Ugc3BlY2lmeSBhcyBrZXlfZXhwb3J0VmFsdWVLZXkuIGUuZy4gcmVzdEFQSV9yZXN0QXBpSWRgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29uc3Qgc3NtS2V5ID0gdGhpcy5lbnZpcm9ubWVudFZhcmlhYmxlc1sgZW5zdXJlVmFsaWRFbnZLZXkobmFtZSwgYFNTTToke3ByZWZpeH1gKSBdO1xuXG4gICAgICAgICAgICAgICAgaWYgKHNzbUtleSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFja05hbWUgPSBzc21LZXkuc3BsaXQoJy8nKVsgMSBdO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2hlY2tpbmcgaWYgbXVsdGktc3RhY2sgc2V0dXAgc2hvdWxkIGJlIHVzZWQgZm9yIGVudmlyb25tZW50IHZhcmlhYmxlOiAke2Vuc3VyZVZhbGlkRW52S2V5KG5hbWUsIHByZWZpeCl9IGluIHN0YWNrOiAke3N0YWNrTmFtZX0gY2FsbGVkIGZyb20gc3RhY2s6ICR7c2NvcGUuc3RhY2tOYW1lfSAtICR7dGhpcy51c2VNdWx0aVN0YWNrU2V0dXAoc3RhY2tOYW1lLCBzY29wZSl9YCk7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnVzZU11bHRpU3RhY2tTZXR1cChzdGFja05hbWUsIHNjb3BlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQWRkIGNyb3NzLXN0YWNrIGRlcGVuZGVuY3lcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNvdXJjZVN0YWNrID0gdGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNvdXJjZVN0YWNrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2NvcGUuYWRkRGVwZW5kZW5jeShzb3VyY2VTdGFjayk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGVkIGRlcGVuZGVuY3kgZnJvbSAke3Njb3BlLnN0YWNrTmFtZX0gdG8gJHtzdGFja05hbWV9IGZvciBTU00ga2V5OiAke3NzbUtleX1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEF0dGVtcHRpbmcgdG8gaW1wb3J0IFNTTSB2YWx1ZSBmb3Iga2V5OiAke3NzbUtleX1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gU3RyaW5nUGFyYW1ldGVyLnZhbHVlRm9yU3RyaW5nUGFyYW1ldGVyKHNjb3BlLCBzc21LZXkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBTU00ga2V5IGZvdW5kIGluIGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3Iga2V5OiAke2Vuc3VyZVZhbGlkRW52S2V5KG5hbWUsIGBTU006JHtwcmVmaXh9YCl9LCB1c2luZyBkaXJlY3QgcmVmZXJlbmNlYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZW52aXJvbm1lbnRWYXJpYWJsZXNbIGVuc3VyZVZhbGlkRW52S2V5KG5hbWUsIHByZWZpeCkgXTtcbiAgICB9XG5cbiAgICBoYXNFbnZpcm9ubWVudFZhcmlhYmxlKG5hbWU6IHN0cmluZywgcHJlZml4OiBzdHJpbmcgPSAnJyk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gKGVuc3VyZVZhbGlkRW52S2V5KG5hbWUsIHByZWZpeCkgaW4gdGhpcy5lbnZpcm9ubWVudFZhcmlhYmxlcyk7XG4gICAgfVxuXG4gICAgcmVzb2x2ZUVudlZhcmlhYmxlcyA9IChlbnY6IElMYW1iZGFFbnZDb25maWdbXSA9IFtdLCBzY29wZT86IGFueSkgPT4ge1xuICAgICAgICBjb25zdCByZXNvbHZlZDogYW55ID0ge307XG4gICAgICAgIGZvciAoY29uc3QgZW52Q29uZmlnIG9mIGVudikge1xuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBlbnZDb25maWcudmFsdWUgPz8gdGhpcy5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGVudkNvbmZpZy5uYW1lLCBlbnZDb25maWcucHJlZml4LCBzY29wZSk7XG4gICAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICByZXNvbHZlZFsgZW52Q29uZmlnLmV4cG9ydE5hbWUgPz8gZW52Q29uZmlnLm5hbWUgXSA9IHZhbHVlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBFbnZpcm9ubWVudCB2YXJpYWJsZSBbcHJlZml4OiAke2VudkNvbmZpZy5wcmVmaXh9XSAke2VudkNvbmZpZy5uYW1lfSBub3QgZm91bmQgaW4gdGhlIGVudmlyb25tZW50IHZhcmlhYmxlcy5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzb2x2ZWQ7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyB0aGUgdmFsdWUgZm9yIHRoZSBnaXZlbiB0ZW1wbGF0ZSBmcm9tIHRoZSBGdzI0LXNjb3BlIGVudiBpZiBpdCBmb2xsb3dzIHRoZSBjb252ZW50aW9ucyBsaWtlIGBlbnY6eHh4Onl5eWAsIGBlbnY6eXl5YC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ga2V5VGVtcGxhdGUgLSBUaGUgdGVtcGxhdGUgZm9yIHRoZSBlbnZpcm9ubWVudCBrZXkgdG8gcmVzb2x2ZS5cbiAgICAgKiAgZS5nLiBlbnY6VXNlcnNfVGFibGVfbmFtZSwgZW52OnVzZXJNb2R1bGU6VXNlcnNfVGFibGVfbmFtZVxuICAgICAqIEByZXR1cm5zIFRoZSByZXNvbHZlZCB2YWx1ZSBmb3IgdGhlIGtleS5cbiAgICAgKi9cbiAgICB0cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUgPSAoa2V5VGVtcGxhdGU6IHN0cmluZykgPT4ge1xuICAgICAgICBpZiAoa2V5VGVtcGxhdGUuc3RhcnRzV2l0aCgnZW52OicpKSB7XG4gICAgICAgICAgICAvLyBlbnY6dXNlck1vZHVsZTpVc2Vyc19UYWJsZV9uYW1lID0+IFsnZW52JywgJ3VzZXJNb2R1bGUnLCAnVXNlcnNfVGFibGVfbmFtZSddO1xuICAgICAgICAgICAgY29uc3QgcGFydHMgPSBrZXlUZW1wbGF0ZS5zcGxpdCgnOicpO1xuXG4gICAgICAgICAgICAvLyBnZXQgdGhlIGFjdHVhbCB2YWx1ZSBmcm9tIHRoZSBmdzI0IHNjb3BlID09PiBmdzI0LmdldCgnVXNlcnNfVGFibGVfbmFtZScsICd1c2VyTW9kdWxlJyk7XG4gICAgICAgICAgICBrZXlUZW1wbGF0ZSA9IHBhcnRzLmxlbmd0aCA9PT0gMyA/IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShwYXJ0c1sgMiBdLCBwYXJ0c1sgMSBdKSA6IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShwYXJ0c1sgMSBdKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ga2V5VGVtcGxhdGU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0IGEgZ2xvYmFsIGVudmlyb25tZW50IHZhcmlhYmxlLiBUaGlzIHZhcmlhYmxlIHdpbGwgYmUgYXZhaWxhYmxlIHRvIGFsbCBsYW1iZGEgZnVuY3Rpb25zLlxuICAgICAqIEBwYXJhbSBuYW1lIFRoZSBuYW1lIG9mIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZS5cbiAgICAgKiBAcGFyYW0gdmFsdWUgVGhlIHZhbHVlIG9mIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZS5cbiAgICAgKi9cbiAgICBzZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlKG5hbWU6IHN0cmluZywgdmFsdWU6IGFueSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwic2V0R2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZTpcIiwgbmFtZSwgdmFsdWUpO1xuICAgICAgICB0aGlzLnNldEVudmlyb25tZW50VmFyaWFibGUobmFtZSwgdmFsdWUsICcnKTtcbiAgICAgICAgdGhpcy5nbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcy5wdXNoKGVuc3VyZVZhbGlkRW52S2V5KG5hbWUsICcnKSk7XG4gICAgfVxuXG4gICAgZ2V0R2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMoKTogc3RyaW5nW10ge1xuICAgICAgICByZXR1cm4gdGhpcy5nbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcztcbiAgICB9XG5cbiAgICBzZXRQb2xpY3kocG9saWN5TmFtZTogc3RyaW5nLCB2YWx1ZTogUG9saWN5U3RhdGVtZW50UHJvcHMgfCBQb2xpY3lTdGF0ZW1lbnQsIHByZWZpeDogc3RyaW5nID0gJycpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJzZXRQb2xpY3k6XCIsIHByZWZpeCwgcG9saWN5TmFtZSwgdmFsdWUpO1xuICAgICAgICB0aGlzLnBvbGljeVN0YXRlbWVudHMuc2V0KGVuc3VyZVZhbGlkRW52S2V5KHBvbGljeU5hbWUsIHByZWZpeCksIHZhbHVlKTtcbiAgICB9XG5cbiAgICBnZXRQb2xpY3kocG9saWN5TmFtZTogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyA9ICcnKTogUG9saWN5U3RhdGVtZW50UHJvcHMgfCBQb2xpY3lTdGF0ZW1lbnQgfCB1bmRlZmluZWQge1xuICAgICAgICByZXR1cm4gdGhpcy5wb2xpY3lTdGF0ZW1lbnRzLmdldChlbnN1cmVWYWxpZEVudktleShwb2xpY3lOYW1lLCBwcmVmaXgpKTtcbiAgICB9XG5cbiAgICBoYXNQb2xpY3kocG9saWN5TmFtZTogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyA9ICcnKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnBvbGljeVN0YXRlbWVudHMuaGFzKGVuc3VyZVZhbGlkRW52S2V5KHBvbGljeU5hbWUsIHByZWZpeCkpO1xuICAgIH1cblxuICAgIC8vIHNldCB0aGUgb3V0cHV0IG9mIGEgY29uc3RydWN0XG4gICAgLy8gaWYgZXhwb3J0VmFsdWVBbGlhcyBpcyBub3QgcHJvdmlkZWQsIHRoZSBleHBvcnQgdmFsdWUga2V5IHdpbGwgYmUgdXNlZCBhcyB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUga2V5LiBpLmUgd2hlbiB1c2luZyBjdXN0b20gcmVzb3VyY2UgbGlrZSBDZm5JZGVudGl0eVBvb2wgXG4gICAgLy8gdGhlIG91dHB1dCBpcyB0aGUgcmVmZXJlbmNlIHRvIHRoZSBjdXN0b20gcmVzb3VyY2UuIFRoZSByZWZlcmVuY2UgaXMgbm90IHRoZSBwaHlzaWNhbCBpZCBvZiB0aGUgY3VzdG9tIHJlc291cmNlLCBidXQgYSBsb2dpY2FsIGlkXG4gICAgLy8gdGhhdCBpcyByZXNvbHZlZCB0byB0aGUgcGh5c2ljYWwgaWQgYXQgcnVudGltZS4gSW4gdGhpcyBjYXNlLCB0aGUgZXhwb3J0VmFsdWVBbGlhcyBpcyB0aGUga2V5IG5hbWUgb2YgdGhlIGN1c3RvbSByZXNvdXJjZS5cbiAgICBzZXRDb25zdHJ1Y3RPdXRwdXQoY29uc3RydWN0OiBGVzI0Q29uc3RydWN0LCBrZXk6IHN0cmluZywgdmFsdWU6IGFueSwgb3V0cHV0VHlwZT86IE91dHB1dFR5cGUsIGV4cG9ydFZhbHVlS2V5Pzogc3RyaW5nLCBleHBvcnRWYWx1ZUFsaWFzPzogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBzZXRDb25zdHJ1Y3RPdXRwdXQ6ICR7Y29uc3RydWN0Lm5hbWV9YCwgeyBvdXRwdXRUeXBlLCBrZXkgfSk7XG4gICAgICAgIGlmIChvdXRwdXRUeXBlKSB7XG4gICAgICAgICAgICBjb25zdHJ1Y3Qub3V0cHV0ID0ge1xuICAgICAgICAgICAgICAgIC4uLmNvbnN0cnVjdC5vdXRwdXQsXG4gICAgICAgICAgICAgICAgWyBvdXRwdXRUeXBlIF06IHtcbiAgICAgICAgICAgICAgICAgICAgLi4uY29uc3RydWN0Lm91dHB1dD8uWyBvdXRwdXRUeXBlIF0sXG4gICAgICAgICAgICAgICAgICAgIFsga2V5IF06IHZhbHVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGtleSwgdmFsdWUsIGAke2NvbnN0cnVjdC5uYW1lfV8ke291dHB1dFR5cGV9YCk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgc2V0RW52aXJvbm1lbnRWYXJpYWJsZTogJHtrZXl9YCwgeyBwcmVmaXg6IGAke2NvbnN0cnVjdC5uYW1lfV8ke291dHB1dFR5cGV9YCB9KTtcblxuICAgICAgICAgICAgLy8gaW4gY2FzZSBvZiBvYmplY3QgcmVmZXJlbmNlLCBleHBvcnQgdGhlIG91dHB1dCB0byBiZSB1c2VkIGluIG90aGVyIHN0YWNrc1xuICAgICAgICAgICAgbGV0IG91dHB1dFZhbHVlID0gdmFsdWU7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiBleHBvcnRWYWx1ZUtleSkge1xuICAgICAgICAgICAgICAgIG91dHB1dFZhbHVlID0gdmFsdWVbIGV4cG9ydFZhbHVlS2V5IF07XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgZXhwb3J0VmFsdWVLZXkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ3JlYXRlIENsb3VkRm9ybWF0aW9uIGV4cG9ydCB3aXRoIHZhbGlkIG5hbWluZ1xuICAgICAgICAgICAgY29uc3Qgc2FuaXRpemVkS2V5ID0gZW5zdXJlVmFsaWRFbnZLZXkoa2V5LCAnJywgJycsIHRydWUpO1xuICAgICAgICAgICAgY29uc3QgZXhwb3J0S2V5ID0gYCR7b3V0cHV0VHlwZX0ke3Nhbml0aXplZEtleX0ke2V4cG9ydFZhbHVlQWxpYXMgfHwgZXhwb3J0VmFsdWVLZXl9YDtcbiAgICAgICAgICAgIGNvbnN0IHN0YWNrRXhwb3J0TmFtZSA9IGAke2NvbnN0cnVjdC5tYWluU3RhY2suc3RhY2tOYW1lfS0ke2V4cG9ydEtleX1gO1xuXG4gICAgICAgICAgICBuZXcgQ2ZuT3V0cHV0KGNvbnN0cnVjdC5tYWluU3RhY2ssIGV4cG9ydEtleSwge1xuICAgICAgICAgICAgICAgIHZhbHVlOiBvdXRwdXRWYWx1ZSxcbiAgICAgICAgICAgICAgICBleHBvcnROYW1lOiBzdGFja0V4cG9ydE5hbWUsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gc2V0IHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdGhlIGRpcmVjdCByZWZlcmVuY2VcbiAgICAgICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShgJHtrZXl9XyR7ZXhwb3J0VmFsdWVBbGlhcyB8fCBleHBvcnRWYWx1ZUtleX1gLCBvdXRwdXRWYWx1ZSwgb3V0cHV0VHlwZSk7XG4gICAgICAgICAgICAvLyBTdG9yZSBTU00gcGFyYW1ldGVyIGZvciBjcm9zcy1zdGFjayByZWZlcmVuY2VcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGB1c2VNdWx0aVN0YWNrU2V0dXA6ICR7dGhpcy51c2VNdWx0aVN0YWNrU2V0dXAoKX1gKTtcbiAgICAgICAgICAgIGlmICh0aGlzLnVzZU11bHRpU3RhY2tTZXR1cCgpKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc3NtS2V5ID0gYC8ke2NvbnN0cnVjdC5tYWluU3RhY2suc3RhY2tOYW1lfS8ke291dHB1dFR5cGV9LyR7c2FuaXRpemVkS2V5fS8ke2V4cG9ydFZhbHVlQWxpYXMgfHwgZXhwb3J0VmFsdWVLZXl9YDtcbiAgICAgICAgICAgICAgICAvLyBzZXQgdGhlIGVudmlyb25tZW50IHZhcmlhYmxlIGZvciB0aGUgY3Jvc3Mtc3RhY2sgcmVmZXJlbmNlIHVzaW5nIFNTTSBwYXJhbWV0ZXJcbiAgICAgICAgICAgICAgICB0aGlzLnNldEVudmlyb25tZW50VmFyaWFibGUoYCR7a2V5fV8ke2V4cG9ydFZhbHVlQWxpYXMgfHwgZXhwb3J0VmFsdWVLZXl9YCwgc3NtS2V5LCBgU1NNOiR7b3V0cHV0VHlwZX1gKTtcbiAgICAgICAgICAgICAgICBuZXcgU3RyaW5nUGFyYW1ldGVyKGNvbnN0cnVjdC5tYWluU3RhY2ssIGBTU00ke291dHB1dFR5cGV9JHtzYW5pdGl6ZWRLZXl9JHtleHBvcnRWYWx1ZUFsaWFzIHx8IGV4cG9ydFZhbHVlS2V5fWAsIHtcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1ldGVyTmFtZTogc3NtS2V5LFxuICAgICAgICAgICAgICAgICAgICBzdHJpbmdWYWx1ZTogb3V0cHV0VmFsdWUsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0cnVjdC5vdXRwdXQgPSB7XG4gICAgICAgICAgICAgICAgLi4uY29uc3RydWN0Lm91dHB1dCxcbiAgICAgICAgICAgICAgICBbIGtleSBdOiB2YWx1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGtleSwgdmFsdWUsIGNvbnN0cnVjdC5uYW1lKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZER5bmFtb1RhYmxlKG5hbWU6IHN0cmluZywgdGFibGU6IFRhYmxlVjIpIHtcbiAgICAgICAgbmFtZSA9IGVuc3VyZU5vU3BlY2lhbENoYXJzKG5hbWUpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImFkZER5bmFtb1RhYmxlOlwiLCB7IG5hbWUgfSk7XG4gICAgICAgIHRoaXMuZHluYW1vVGFibGVzWyBuYW1lIF0gPSB0YWJsZTtcbiAgICB9XG5cbiAgICBnZXREeW5hbW9UYWJsZShuYW1lOiBzdHJpbmcpOiBUYWJsZVYyIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZHluYW1vVGFibGVzWyBlbnN1cmVOb1NwZWNpYWxDaGFycyhuYW1lKSBdO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldHMgYSBxdWV1ZSByZWZlcmVuY2UgYnkgbmFtZSwgZm9sbG93aW5nIHRoZSBmcmFtZXdvcmsncyBwYXR0ZXJuIGZvciBleGlzdGluZyByZXNvdXJjZSByZWZlcmVuY2VzLlxuICAgICAqIEBwYXJhbSBxdWV1ZU5hbWUgVGhlIG5hbWUgb2YgdGhlIHF1ZXVlXG4gICAgICogQHBhcmFtIHNjb3BlIE9wdGlvbmFsIHNjb3BlIGZvciBzdGFjayByZXNvbHV0aW9uIFxuICAgICAqIEBwYXJhbSBjb25zdHJ1Y3RJZCBPcHRpb25hbCBjb25zdHJ1Y3QgSUQgZm9yIHVuaXF1ZSBuYW1pbmdcbiAgICAgKiBAcmV0dXJucyBRdWV1ZSBpbnN0YW5jZSByZWZlcmVuY2VkIGJ5IEFSTlxuICAgICAqL1xuICAgIGdldFF1ZXVlQnlOYW1lKHF1ZXVlTmFtZTogc3RyaW5nLCBzY29wZT86IGFueSwgY29uc3RydWN0SWQ/OiBzdHJpbmcpOiBJUXVldWUge1xuICAgICAgICBjb25zdCBxdWV1ZVVybCA9IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShxdWV1ZU5hbWUgKyAnX3F1ZXVlTmFtZScsICdxdWV1ZScsIHNjb3BlKTtcbiAgICAgICAgY29uc3QgcXVldWVBcm4gPSB0aGlzLmdldEFybignc3FzJywgcXVldWVVcmwpO1xuICAgICAgICBjb25zdCB1bmlxdWVJZCA9IGNvbnN0cnVjdElkID8gYCR7Y29uc3RydWN0SWR9LSR7cXVldWVOYW1lfS1xdWV1ZWAgOiBgJHtxdWV1ZU5hbWV9LXF1ZXVlYDtcbiAgICAgICAgcmV0dXJuIFF1ZXVlLmZyb21RdWV1ZUFybihzY29wZSA/PyB0aGlzLmdldFN0YWNrKCksIHVuaXF1ZUlkLCBxdWV1ZUFybik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0cyBhIHRvcGljIHJlZmVyZW5jZSBieSBuYW1lLCBmb2xsb3dpbmcgdGhlIGZyYW1ld29yaydzIHBhdHRlcm4gZm9yIGV4aXN0aW5nIHJlc291cmNlIHJlZmVyZW5jZXMuXG4gICAgICogQHBhcmFtIHRvcGljTmFtZSBUaGUgbmFtZSBvZiB0aGUgdG9waWNcbiAgICAgKiBAcGFyYW0gc2NvcGUgT3B0aW9uYWwgc2NvcGUgZm9yIHN0YWNrIHJlc29sdXRpb25cbiAgICAgKiBAcGFyYW0gY29uc3RydWN0SWQgT3B0aW9uYWwgY29uc3RydWN0IElEIGZvciB1bmlxdWUgbmFtaW5nICBcbiAgICAgKiBAcmV0dXJucyBUb3BpYyBpbnN0YW5jZSByZWZlcmVuY2VkIGJ5IEFSTlxuICAgICAqL1xuICAgIGdldFRvcGljQnlOYW1lKHRvcGljTmFtZTogc3RyaW5nLCBzY29wZT86IGFueSwgY29uc3RydWN0SWQ/OiBzdHJpbmcpOiBJVG9waWMge1xuICAgICAgICBjb25zdCB0b3BpY0FyblZhbHVlID0gdGhpcy5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRvcGljTmFtZSwgJ3RvcGljTmFtZScpO1xuICAgICAgICBjb25zdCB0b3BpY0FybiA9IHRoaXMuZ2V0QXJuKCdzbnMnLCB0b3BpY0FyblZhbHVlKTtcbiAgICAgICAgY29uc3QgdW5pcXVlSWQgPSBjb25zdHJ1Y3RJZCA/IGAke2NvbnN0cnVjdElkfS0ke3RvcGljTmFtZX0tdG9waWNgIDogYCR7dG9waWNOYW1lfS10b3BpY2A7XG4gICAgICAgIHJldHVybiBUb3BpYy5mcm9tVG9waWNBcm4oc2NvcGUgPz8gdGhpcy5nZXRTdGFjaygpLCB1bmlxdWVJZCwgdG9waWNBcm4pO1xuICAgIH1cblxuICAgIGFkZFJvdXRlVG9Sb2xlUG9saWN5KHJvdXRlOiBzdHJpbmcsIGdyb3Vwczogc3RyaW5nW10sIHJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgICAgICBpZiAoIWdyb3VwcyB8fCBncm91cHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBncm91cHMgPSB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUoJ0dyb3VwcycsICdjb2duaXRvJyk7XG4gICAgICAgICAgICBpZiAoIWdyb3Vwcykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIGdyb3VwcyBkZWZpbmVkLiBBZGRpbmcgcm91dGU6ICR7cm91dGV9IHRvIHJvbGUgcG9saWN5IGZvciBkZWZhdWx0IGF1dGhlbnRpY2F0ZWQgcm9sZS5gKTtcbiAgICAgICAgICAgICAgICBncm91cHMgPSBbICdkZWZhdWx0JyBdO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGxldCByb3V0ZUFkZGVkVG9Hcm91cFBvbGljeSA9IGZhbHNlO1xuICAgICAgICBmb3IgKGNvbnN0IGdyb3VwTmFtZSBvZiBncm91cHMpIHtcbiAgICAgICAgICAgIC8vIGlmIHJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgaXMgdHJ1ZSwgY2hlY2sgaWYgdGhlIHJvdXRlIGlzIGluIHRoZSBncm91cCBjb25maWdcbiAgICAgICAgICAgIGlmIChyZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnICYmICghdGhpcy5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdSb3V0ZXMnLCAnY29nbml0b18nICsgZ3JvdXBOYW1lKSB8fCAhdGhpcy5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdSb3V0ZXMnLCAnY29nbml0b18nICsgZ3JvdXBOYW1lKS5pbmNsdWRlcyhyb3V0ZSkpKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBnZXQgcm9sZVxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhZGRSb3V0ZVRvUm9sZVBvbGljeTpcIiwgeyByb3V0ZSwgZ3JvdXBOYW1lIH0pO1xuICAgICAgICAgICAgY29uc3Qgcm9sZTogUm9sZSA9IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnUm9sZScsICdjb2duaXRvXycgKyBncm91cE5hbWUpO1xuICAgICAgICAgICAgaWYgKCFyb2xlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFJvbGUgbm90IGZvdW5kIGZvciBncm91cDogJHtncm91cE5hbWV9LiBSb2xlIGlzIHJlcXVpcmVkIHRvIGFkZCByb3V0ZTogJHtyb3V0ZX0gdG8gcm9sZSBwb2xpY3kuIFBsZWFzZSBtYWtlIHN1cmUgeW91IGhhdmUgYSBncm91cCBkZWZpbmVkIGluIHlvdXIgY29uZmlnIHdpdGggdGhlIG5hbWU6ICR7Z3JvdXBOYW1lfS5gKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBhZGQgcm9sZSBwb2xpY3kgc3RhdGVtZW50IHRvIGFsbG93IHJvdXRlIGFjY2VzcyBmb3IgZ3JvdXBcbiAgICAgICAgICAgIHJvbGUuYWRkVG9Qb2xpY3kodGhpcy5nZXRSb3V0ZVBvbGljeVN0YXRlbWVudChyb3V0ZSkpO1xuICAgICAgICAgICAgcm91dGVBZGRlZFRvR3JvdXBQb2xpY3kgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghcm91dGVBZGRlZFRvR3JvdXBQb2xpY3kpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBSb3V0ZSAke3JvdXRlfSBub3QgZm91bmQgaW4gYW55IGdyb3VwIGNvbmZpZy4gUGxlYXNlIGFkZCB0aGUgcm91dGUgdG8gYSBncm91cCBjb25maWcgdG8gc2VjdXJlIGFjY2Vzcy5gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldFJvdXRlUG9saWN5U3RhdGVtZW50KHJvdXRlOiBzdHJpbmcpIHtcbiAgICAgICAgLy8gd3JpdGUgdGhlIHBvbGljeSBzdGF0ZW1lbnRcbiAgICAgICAgY29uc3Qgc3RhdGVtZW50ID0gbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBlZmZlY3Q6IEVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgIGFjdGlvbnM6IFsgJ2V4ZWN1dGUtYXBpOkludm9rZScgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogWyBgYXJuOmF3czpleGVjdXRlLWFwaToqOio6Ki8qLyovJHtyb3V0ZX1gIF0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiUm91dGVQb2xpY3lTdGF0ZW1lbnQ6XCIsIHsgcm91dGUgfSk7XG5cbiAgICAgICAgcmV0dXJuIHN0YXRlbWVudDtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0Q29uc3RydWN0T3V0cHV0PFQ+KHR5cGU6IE91dHB1dFR5cGUsIG5hbWU6IHN0cmluZyk6IFQgfCB1bmRlZmluZWQge1xuICAgICAgICAvLyBMb29rIHRocm91Z2ggYWxsIGNvbnN0cnVjdHMgdG8gZmluZCB0aGUgb3V0cHV0XG4gICAgICAgIGZvciAoY29uc3QgY29uc3RydWN0IG9mIHRoaXMuY29uc3RydWN0cy52YWx1ZXMoKSkge1xuICAgICAgICAgICAgaWYgKGNvbnN0cnVjdC5vdXRwdXQ/LlsgdHlwZSBdPy5bIG5hbWUgXSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBjb25zdHJ1Y3Qub3V0cHV0WyB0eXBlIF1bIG5hbWUgXSBhcyBUO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgcHVibGljIGFkZENvbnN0cnVjdChjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QpIHtcbiAgICAgICAgdGhpcy5jb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3QubmFtZSwgY29uc3RydWN0KTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0VnBjKHZwY05hbWU6IHN0cmluZyk6IFZwYyB7XG4gICAgICAgIGNvbnN0IHZwYyA9IHRoaXMuZ2V0Q29uc3RydWN0T3V0cHV0PFZwYz4oT3V0cHV0VHlwZS5WUEMsIHZwY05hbWUpO1xuICAgICAgICBpZiAoIXZwYykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBWUEMgJHt2cGNOYW1lfSBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdnBjO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRIb3N0ZWRab25lKGRvbWFpbk5hbWU6IHN0cmluZyk6IElIb3N0ZWRab25lIHtcbiAgICAgICAgLy8gTG9vayB1cCB0aGUgaG9zdGVkIHpvbmUgYnkgZG9tYWluIG5hbWVcbiAgICAgICAgcmV0dXJuIEhvc3RlZFpvbmUuZnJvbUxvb2t1cCh0aGlzLmFwcCwgYCR7ZG9tYWluTmFtZX0tem9uZWAsIHtcbiAgICAgICAgICAgIGRvbWFpbk5hbWUsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHNldEp3dEF1dGhvcml6ZXIoYXV0aG9yaXplcjogSUF1dGhvcml6ZXIsIGRlZmF1bHRBdXRob3JpemVyOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJzZXRKd3RBdXRob3JpemVyOiBcIiwgeyBhdXRob3JpemVyOiBhdXRob3JpemVyLmF1dGhvcml6ZXJJZCB9KTtcbiAgICAgICAgdGhpcy5qd3RBdXRob3JpemVyID0gYXV0aG9yaXplcjtcbiAgICAgICAgaWYgKGRlZmF1bHRBdXRob3JpemVyKSB7XG4gICAgICAgICAgICB0aGlzLmRlZmF1bHRBdXRob3JpemVyID0gYXV0aG9yaXplcjtcbiAgICAgICAgICAgIHRoaXMuZ2V0Q29uZmlnKCkuZGVmYXVsdEF1dGhvcml6YXRpb25UeXBlID0gJ0pXVCc7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRKd3RBdXRob3JpemVyKCk6IElBdXRob3JpemVyIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuand0QXV0aG9yaXplcjtcbiAgICB9XG5cbiAgICBwdWJsaWMgcmVnaXN0ZXJTeXN0ZW1Db250cm9sbGVyKGNvbnRyb2xsZXI6IFN5c3RlbUNvbnRyb2xsZXJEZWZpbml0aW9uKSB7XG4gICAgICAgIHRoaXMuc3lzdGVtQ29udHJvbGxlcnMuc2V0KGNvbnRyb2xsZXIucGF0aCwgY29udHJvbGxlcik7XG4gICAgfVxuICAgIHB1YmxpYyBoYXNTeXN0ZW1Db250cm9sbGVyKHBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gdGhpcy5zeXN0ZW1Db250cm9sbGVycy5oYXMocGF0aCk7XG4gICAgfVxuICAgIHB1YmxpYyBnZXRTeXN0ZW1Db250cm9sbGVyKHBhdGg6IHN0cmluZyk6IFN5c3RlbUNvbnRyb2xsZXJEZWZpbml0aW9uIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3lzdGVtQ29udHJvbGxlcnMuZ2V0KHBhdGgpO1xuICAgIH1cbiAgICBwdWJsaWMgaGFzU3lzdGVtQ29udHJvbGxlcnMoKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5c3RlbUNvbnRyb2xsZXJzLnNpemUgPiAwO1xuICAgIH1cbiAgICBwdWJsaWMgZ2V0U3lzdGVtQ29udHJvbGxlcnMoKTogU3lzdGVtQ29udHJvbGxlckRlZmluaXRpb25bXSB7XG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKHRoaXMuc3lzdGVtQ29udHJvbGxlcnMudmFsdWVzKCkpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyByZWdpc3RlclN5c3RlbVVJQ29uZmlnKG5hbWU6IHN0cmluZywgY29uZmlnOiBTeXN0ZW1VSVBhZ2VEZWZpbml0aW9uKSB7XG4gICAgICAgIHRoaXMuc3lzdGVtVUlDb25maWdzLnNldChuYW1lLCBjb25maWcpO1xuICAgIH1cbiAgICBwdWJsaWMgaGFzU3lzdGVtVUlDb25maWcobmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5c3RlbVVJQ29uZmlncy5oYXMobmFtZSk7XG4gICAgfVxuICAgIHB1YmxpYyBnZXRTeXN0ZW1VSUNvbmZpZyhuYW1lOiBzdHJpbmcpOiBTeXN0ZW1VSVBhZ2VEZWZpbml0aW9uIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3lzdGVtVUlDb25maWdzLmdldChuYW1lKTtcbiAgICB9XG4gICAgcHVibGljIGdldFN5c3RlbVVJQ29uZmlncygpOiBTeXN0ZW1VSVBhZ2VEZWZpbml0aW9uW10ge1xuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbSh0aGlzLnN5c3RlbVVJQ29uZmlncy52YWx1ZXMoKSk7XG4gICAgfVxuICAgIHB1YmxpYyBoYXNTeXN0ZW1VSUNvbmZpZ3MoKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5c3RlbVVJQ29uZmlncy5zaXplID4gMDtcbiAgICB9XG59Il19