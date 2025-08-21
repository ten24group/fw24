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
    globalLambdaEntryPackages = new Set();
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
        return this.config.lambdaEntryPackages || Array.from(this.globalLambdaEntryPackages);
    }
    addGlobalLambdaEntryPackage(packageName) {
        this.globalLambdaEntryPackages.add(packageName);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZncyNC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb3JlL2Z3MjQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRUEsaURBQW9HO0FBRXBHLGlEQUE0QztBQUM1QyxpREFBb0Q7QUFDcEQsOEJBQW9DO0FBR3BDLHVEQUFvRTtBQUVwRSx3Q0FBMEM7QUFDMUMscUNBQWtDO0FBRWxDLHdDQUF3RTtBQUN4RSw2Q0FBcUU7QUFDckUsaURBQXNEO0FBRXRELHlEQUFrRTtBQUVsRSxNQUFhLElBQUk7SUFDSixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUUxQyxPQUFPLEdBQVcsTUFBTSxDQUFDO0lBQ3pCLGFBQWEsQ0FBTTtJQUVYLE1BQU0sR0FBdUIsRUFBRSxDQUFDO0lBQ2hDLEdBQUcsQ0FBTztJQUNWLE1BQU0sR0FBMEIsRUFBRSxDQUFDO0lBQ25DLElBQUksR0FBZ0UsRUFBRSxDQUFDO0lBQ3ZFLG9CQUFvQixHQUF3QixFQUFFLENBQUM7SUFDL0MsMEJBQTBCLEdBQWEsRUFBRSxDQUFDO0lBQzFDLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFrRCxDQUFDO0lBQzdFLGlCQUFpQixDQUEwQjtJQUMzQyxrQkFBa0IsR0FBcUMsRUFBRSxDQUFDO0lBQzFELGFBQWEsQ0FBMEI7SUFDdkMsWUFBWSxHQUFpQyxFQUFFLENBQUM7SUFDaEQsTUFBTSxDQUFDLFFBQVEsQ0FBTztJQUV0QixNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQWtCLENBQUM7SUFDbkMsTUFBTSxHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO0lBQ25DLE9BQU8sR0FBRyxJQUFJLEdBQUcsRUFBdUIsQ0FBQztJQUN6QyxVQUFVLEdBQUcsSUFBSSxHQUFHLEVBQXlCLENBQUM7SUFFckMsc0JBQXNCLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQztJQUMzQyx5QkFBeUIsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFD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OEI7UUFDNUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQzNDLENBQUM7SUFDTSxpQkFBaUIsQ0FBQyxJQUFZO1FBQ2pDLE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDMUMsQ0FBQztJQUNNLGlCQUFpQixDQUFDLElBQVk7UUFDakMsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMxQyxDQUFDO0lBQ00sa0JBQWtCO1FBQ3JCLE9BQU8sS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7SUFDckQsQ0FBQztJQUNNLGtCQUFrQjtRQUNyQixPQUFPLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQztJQUN6QyxDQUFDO0NBQ0o7QUExbEJELG9CQTBsQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBJQXV0aG9yaXplciB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5djInO1xuaW1wb3J0IHsgVGFibGVWMiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgeyBFZmZlY3QsIFBvbGljeVN0YXRlbWVudCwgdHlwZSBQb2xpY3lTdGF0ZW1lbnRQcm9wcywgdHlwZSBSb2xlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgdHlwZSB7IElUb3BpYyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0IHsgVG9waWMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJztcbmltcG9ydCB7IElRdWV1ZSwgUXVldWUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJztcbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnLi4vZGknO1xuaW1wb3J0IHsgdHlwZSBJTGFtYmRhRW52Q29uZmlnIH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBJQXBwbGljYXRpb25Db25maWcsIFN5c3RlbUNvbnRyb2xsZXJEZWZpbml0aW9uLCBTeXN0ZW1VSVBhZ2VEZWZpbml0aW9uIH0gZnJvbSAnLi4vaW50ZXJmYWNlcy9jb25maWcnO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgT3V0cHV0VHlwZSB9IGZyb20gJy4uL2ludGVyZmFjZXMvY29uc3RydWN0JztcbmltcG9ydCB7IHR5cGUgSURJQ29udGFpbmVyIH0gZnJvbSAnLi4vaW50ZXJmYWNlcy9kaSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi9sb2dnaW5nJztcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gJy4vaGVscGVyJztcbmltcG9ydCB7IHR5cGUgSUZ3MjRNb2R1bGUgfSBmcm9tICcuL3J1bnRpbWUvbW9kdWxlJztcbmltcG9ydCB7IGVuc3VyZU5vU3BlY2lhbENoYXJzLCBlbnN1cmVWYWxpZEVudktleSB9IGZyb20gJy4uL3V0aWxzL2tleXMnO1xuaW1wb3J0IHsgQXBwLCBDZm5PdXRwdXQsIEZuLCBOZXN0ZWRTdGFjaywgU3RhY2sgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBTdHJpbmdQYXJhbWV0ZXIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJztcbmltcG9ydCB7IFZwYyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0IHsgSUhvc3RlZFpvbmUsIEhvc3RlZFpvbmUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtcm91dGU1Myc7XG5cbmV4cG9ydCBjbGFzcyBGdzI0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoRncyNC5uYW1lKTtcblxuICAgIGFwcE5hbWU6IHN0cmluZyA9IFwiZncyNFwiO1xuICAgIGVtYWlsUHJvdmlkZXI6IGFueTtcblxuICAgIHByaXZhdGUgY29uZmlnOiBJQXBwbGljYXRpb25Db25maWcgPSB7fTtcbiAgICBwcml2YXRlIGFwcCE6IEFwcDtcbiAgICBwcml2YXRlIHN0YWNrczogUmVjb3JkPHN0cmluZywgU3RhY2s+ID0ge307XG4gICAgcHJpdmF0ZSBhcGlzOiB7IFsgYXBpQ29uc3RydWN0TmFtZTogc3RyaW5nIF06IHsgWyBuYW1lOiBzdHJpbmcgXTogYW55IH0gfSA9IHt9O1xuICAgIHByaXZhdGUgZW52aXJvbm1lbnRWYXJpYWJsZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBwcml2YXRlIGdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHByaXZhdGUgcG9saWN5U3RhdGVtZW50cyA9IG5ldyBNYXA8c3RyaW5nLCBQb2xpY3lTdGF0ZW1lbnRQcm9wcyB8IFBvbGljeVN0YXRlbWVudD4oKTtcbiAgICBwcml2YXRlIGRlZmF1bHRBdXRob3JpemVyOiBJQXV0aG9yaXplciB8IHVuZGVmaW5lZDtcbiAgICBwcml2YXRlIGNvZ25pdG9BdXRob3JpemVyczogeyBbIGtleTogc3RyaW5nIF06IElBdXRob3JpemVyIH0gPSB7fTtcbiAgICBwcml2YXRlIGp3dEF1dGhvcml6ZXI6IElBdXRob3JpemVyIHwgdW5kZWZpbmVkO1xuICAgIHByaXZhdGUgZHluYW1vVGFibGVzOiB7IFsga2V5OiBzdHJpbmcgXTogVGFibGVWMiB9ID0ge307XG4gICAgcHJpdmF0ZSBzdGF0aWMgaW5zdGFuY2U6IEZ3MjQ7XG5cbiAgICBwcml2YXRlIHF1ZXVlcyA9IG5ldyBNYXA8c3RyaW5nLCBJUXVldWU+KCk7XG4gICAgcHJpdmF0ZSB0b3BpY3MgPSBuZXcgTWFwPHN0cmluZywgSVRvcGljPigpO1xuICAgIHByaXZhdGUgbW9kdWxlcyA9IG5ldyBNYXA8c3RyaW5nLCBJRncyNE1vZHVsZT4oKTtcbiAgICBwcml2YXRlIGNvbnN0cnVjdHMgPSBuZXcgTWFwPHN0cmluZywgRlcyNENvbnN0cnVjdD4oKTtcblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZ2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgZ2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgcHJpdmF0ZSByZWFkb25seSBzeXN0ZW1VSUNvbmZpZ3M6IE1hcDxzdHJpbmcsIFN5c3RlbVVJUGFnZURlZmluaXRpb24+ID0gbmV3IE1hcCgpO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgc3lzdGVtQ29udHJvbGxlcnM6IE1hcDxzdHJpbmcsIFN5c3RlbUNvbnRyb2xsZXJEZWZpbml0aW9uPiA9IG5ldyBNYXAoKTtcblxuICAgIHByaXZhdGUgY29uc3RydWN0b3IoKSB7IH0gLy8gRW1wdHkgY29uc3RydWN0b3IgYXMgQXBwIGlzIHNldCB2aWEgc2V0QXBwKClcblxuICAgIHN0YXRpYyBnZXRJbnN0YW5jZSgpOiBGdzI0IHtcbiAgICAgICAgaWYgKCFGdzI0Lmluc3RhbmNlKSB7XG4gICAgICAgICAgICBGdzI0Lmluc3RhbmNlID0gbmV3IEZ3MjQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBGdzI0Lmluc3RhbmNlO1xuICAgIH1cblxuICAgIHNldEFwcChhcHA6IEFwcCkge1xuICAgICAgICB0aGlzLmFwcCA9IGFwcDtcbiAgICB9XG5cbiAgICBnZXRBcHAoKTogQXBwIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuYXBwO1xuICAgIH1cblxuICAgIHNldENvbmZpZyhjb25maWc6IElBcHBsaWNhdGlvbkNvbmZpZykge1xuICAgICAgICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgICAgICAgLy8gSHlkcmF0ZSB0aGUgY29uZmlnIG9iamVjdCB3aXRoIGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyh0aGlzLmNvbmZpZyk7XG4gICAgICAgIC8vIFNldCB0aGUgYXBwIG5hbWVcbiAgICAgICAgdGhpcy5hcHBOYW1lID0gY29uZmlnLm5hbWUhO1xuICAgIH1cblxuICAgIGdldENvbmZpZygpOiBJQXBwbGljYXRpb25Db25maWcge1xuICAgICAgICByZXR1cm4gdGhpcy5jb25maWc7XG4gICAgfVxuXG4gICAgZ2V0QXBwRElDb250YWluZXIoKTogSURJQ29udGFpbmVyIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmFwcERJQ29udGFpbmVyIHx8IERJQ29udGFpbmVyLlJPT1Q7XG4gICAgfVxuXG4gICAgZ2V0TGFtYmRhRW50cnlQYWNrYWdlcygpOiBzdHJpbmdbXSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5sYW1iZGFFbnRyeVBhY2thZ2VzIHx8IEFycmF5LmZyb20odGhpcy5nbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2VzKTtcbiAgICB9XG5cbiAgICBhZGRHbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2UocGFja2FnZU5hbWU6IHN0cmluZykge1xuICAgICAgICB0aGlzLmdsb2JhbExhbWJkYUVudHJ5UGFja2FnZXMuYWRkKHBhY2thZ2VOYW1lKTtcbiAgICB9XG5cbiAgICBoYXNHbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2UocGFja2FnZU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5nbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2VzLmhhcyhwYWNrYWdlTmFtZSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlR2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlKHBhY2thZ2VOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5nbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2VzLmRlbGV0ZShwYWNrYWdlTmFtZSk7XG4gICAgfVxuXG4gICAgZ2V0R2xvYmFsTGFtYmRhTGF5ZXJOYW1lcygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2xvYmFsTGFtYmRhTGF5ZXJOYW1lcztcbiAgICB9XG5cbiAgICBhZGRHbG9iYWxMYW1iZGFMYXllck5hbWVzKGxheWVyTmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuZ2xvYmFsTGFtYmRhTGF5ZXJOYW1lcy5hZGQobGF5ZXJOYW1lKTtcbiAgICB9XG5cbiAgICBoYXNHbG9iYWxMYW1iZGFMYXllck5hbWVzKGxheWVyTmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdsb2JhbExhbWJkYUxheWVyTmFtZXMuaGFzKGxheWVyTmFtZSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlR2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyhsYXllck5hbWU6IHN0cmluZykge1xuICAgICAgICB0aGlzLmdsb2JhbExhbWJkYUxheWVyTmFtZXMuZGVsZXRlKGxheWVyTmFtZSk7XG4gICAgfVxuXG4gICAgYWRkU3RhY2sobmFtZTogc3RyaW5nLCBzdGFjazogYW55KTogRncyNCB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiYWRkU3RhY2s6XCIsIHsgbmFtZSB9KTtcbiAgICAgICAgdGhpcy5zdGFja3NbIG5hbWUgXSA9IHN0YWNrO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHN0YWNrIGJ5IG5hbWUuIElmIHRoZSBzdGFjayBkb2VzIG5vdCBleGlzdCwgY3JlYXRlIGl0LlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBuYW1lIC0gVGhlIG5hbWUgb2YgdGhlIHN0YWNrIHRvIGdldC5cbiAgICAgKiBAcGFyYW0gcGFyZW50U3RhY2tOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIHBhcmVudCBzdGFjay5cbiAgICAgKiBAcmV0dXJucyBUaGUgc3RhY2suXG4gICAgICovXG4gICAgZ2V0U3RhY2sobmFtZT86IHN0cmluZywgcGFyZW50U3RhY2tOYW1lPzogc3RyaW5nKTogYW55IHtcbiAgICAgICAgbGV0IHN0YWNrTmFtZTogc3RyaW5nID0gbmFtZSA/IG5hbWUgOiB0aGlzLmdldERlZmF1bHRTdGFja05hbWUoKTtcbiAgICAgICAgLy8gZG9uJ3QgYWxsb3cgbmVzdGVkIHN0YWNrcyBpZiBtdWx0aVN0YWNrIGlzIHRydWUsIG11bHRpc3RhY2sgaXMgdXNlZCBmb3IgY3JlYXRpbmcgaW5kZXBlbmRlbnQgc3RhY2tzXG4gICAgICAgIGlmICh0aGlzLmNvbmZpZy5tdWx0aVN0YWNrICYmIHBhcmVudFN0YWNrTmFtZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdOZXN0ZWQgc3RhY2tzIGFyZSBub3QgYWxsb3dlZCB3aGVuIG11bHRpU3RhY2sgaXMgdHJ1ZS4gUGxlYXNlIHVzZSBtdWx0aVN0YWNrOiBmYWxzZSBvciByZW1vdmUgdGhlIHBhcmVudFN0YWNrTmFtZSBwYXJhbWV0ZXIuJyk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gaWYgdGhlIHN0YWNrIGRvZXMgbm90IGV4aXN0IGFuZCBtdWx0aVN0YWNrIGlzIGZhbHNlIGFuZCBwYXJlbnRTdGFja05hbWUgaXMgbm90IHByb3ZpZGVkLCB0aGVuIHVzZSB0aGUgZGVmYXVsdCBzdGFjayBuYW1lXG4gICAgICAgIGlmICh0aGlzLnN0YWNrc1sgc3RhY2tOYW1lIF0gPT09IHVuZGVmaW5lZCAmJiAhKHRoaXMuY29uZmlnLm11bHRpU3RhY2sgfHwgcGFyZW50U3RhY2tOYW1lKSkge1xuICAgICAgICAgICAgc3RhY2tOYW1lID0gdGhpcy5nZXREZWZhdWx0U3RhY2tOYW1lKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJHZXR0aW5nIFN0YWNrIFdpdGggTmFtZTpcIiwgeyBzdGFja05hbWUgfSk7XG4gICAgICAgIGlmICh0aGlzLnN0YWNrc1sgc3RhY2tOYW1lIF0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgaWYgKHBhcmVudFN0YWNrTmFtZSkge1xuICAgICAgICAgICAgICAgIC8vIGNyZWF0ZSBhIG5ldyBuZXN0ZWQgc3RhY2tcbiAgICAgICAgICAgICAgICB0aGlzLnN0YWNrc1sgc3RhY2tOYW1lIF0gPSBuZXcgTmVzdGVkU3RhY2sodGhpcy5nZXRTdGFjayhwYXJlbnRTdGFja05hbWUpLCBzdGFja05hbWUpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ3JlYXRlZCBuZXN0ZWQgc3RhY2s6XCIsIHsgc3RhY2tOYW1lLCBwYXJlbnRTdGFja05hbWUgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxldCBzdGFja0lEID0gYCR7dGhpcy5hcHBOYW1lfS0ke3N0YWNrTmFtZX0tc3RhY2tgO1xuICAgICAgICAgICAgICAgIC8vIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5IGZvciBvbGQgc3RhY2sgbmFtZXNcbiAgICAgICAgICAgICAgICBpZiAoc3RhY2tOYW1lID09PSAncHJlbXVsdGlzdGFjaycpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RhY2tJRCA9IGAke3RoaXMuYXBwTmFtZX0tc3RhY2tgO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyBjcmVhdGUgYSBuZXcgc3RhY2tcbiAgICAgICAgICAgICAgICB0aGlzLnN0YWNrc1sgc3RhY2tOYW1lIF0gPSBuZXcgU3RhY2sodGhpcy5hcHAsIHN0YWNrSUQsIHtcbiAgICAgICAgICAgICAgICAgICAgZW52OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhY2NvdW50OiB0aGlzLmNvbmZpZy5hY2NvdW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaW9uOiB0aGlzLmNvbmZpZy5yZWdpb25cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIC8vIG1ha2UgYWxsIHN0YWNrcyBkZXBlbmRlbnQgb24gdGhlIGxheWVyIHN0YWNrXG4gICAgICAgICAgICAgICAgY29uc3QgbGF5ZXJTdGFjayA9IHRoaXMuZ2V0U3RhY2sodGhpcy5jb25maWcubGF5ZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgICAgIGlmIChsYXllclN0YWNrKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhY2tzWyBzdGFja05hbWUgXS5hZGREZXBlbmRlbmN5KGxheWVyU3RhY2spO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNyZWF0ZWQgc3RhY2s6XCIsIHsgc3RhY2tOYW1lIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLnN0YWNrc1sgc3RhY2tOYW1lIF07XG4gICAgfVxuXG4gICAgZ2V0RGVmYXVsdFN0YWNrTmFtZSgpOiBzdHJpbmcge1xuICAgICAgICByZXR1cm4gdGhpcy5jb25maWcuZGVmYXVsdFN0YWNrTmFtZSB8fCAnbWFpbic7XG4gICAgfVxuXG4gICAgdXNlTXVsdGlTdGFja1NldHVwID0gKGN1cnJlbnRTdGFja05hbWU/OiBzdHJpbmcsIHJlc291cmNlU3RhY2s/OiBTdGFjayk6IGJvb2xlYW4gPT4ge1xuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgdGhpcy5nZXRDb25maWcoKS5tdWx0aVN0YWNrXG4gICAgICAgICAgICAmJiB0aGlzLmdldENvbmZpZygpLm11bHRpU3RhY2sgPT09IHRydWVcbiAgICAgICAgICAgICYmIChcbiAgICAgICAgICAgICAgICAvLyBpZiByZXNvdXJjZSBzdGFjayBpcyBub3QgcHJvdmlkZWQsIHRoZW4gb25seSBjaGVjayBpZiBtdWx0aS1zdGFjayBpcyBlbmFibGVkXG4gICAgICAgICAgICAgICAgIXJlc291cmNlU3RhY2sgfHxcbiAgICAgICAgICAgICAgICAvLyBpZiByZXNvdXJjZSBzdGFjayBpcyBwcm92aWRlZCwgdGhlbiBjaGVjayBpZiBpdCBpcyBhIGRpZmZlcmVudCBzdGFjayB0aGFuIHRoZSBjdXJyZW50IHN0YWNrXG4gICAgICAgICAgICAgICAgIShyZXNvdXJjZVN0YWNrPy5zdGFja05hbWUuZW5kc1dpdGgoY3VycmVudFN0YWNrTmFtZSArICctc3RhY2snKSB8fCByZXNvdXJjZVN0YWNrPy5zdGFja05hbWUgPT09IGN1cnJlbnRTdGFja05hbWUpXG4gICAgICAgICAgICApXG4gICAgICAgICkgfHwgZmFsc2U7XG4gICAgfVxuXG4gICAgYWRkQVBJKGFwaUNvbnN0cnVjdE5hbWU6IHN0cmluZywgbmFtZTogc3RyaW5nLCBhcGk6IGFueSwgaXNJbXBvcnRlZDogYm9vbGVhbiA9IGZhbHNlKTogRncyNCB7XG4gICAgICAgIC8vIEluaXRpYWxpemUgdGhlIGFwaUNvbnN0cnVjdE5hbWUgb2JqZWN0IGlmIGl0IGRvZXNuJ3QgZXhpc3RcbiAgICAgICAgaWYgKCF0aGlzLmFwaXNbIGFwaUNvbnN0cnVjdE5hbWUgXSkge1xuICAgICAgICAgICAgdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF0gPSB7fTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImFkZEFQSTpcIiwgeyBuYW1lIH0pO1xuICAgICAgICB0aGlzLmFwaXNbIGFwaUNvbnN0cnVjdE5hbWUgXVsgbmFtZSBdID0geyBhcGk6IGFwaSwgaXNJbXBvcnRlZDogaXNJbXBvcnRlZCB9O1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBnZXRBUEkoYXBpQ29uc3RydWN0TmFtZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBhbnkge1xuICAgICAgICAvLyBDaGVjayBpZiBBUEkgZXhpc3RzIGZvciB0aGUgZ2l2ZW4gbmFtZSBhbmQgc3RhY2tcbiAgICAgICAgaWYgKCF0aGlzLmFwaXNbIGFwaUNvbnN0cnVjdE5hbWUgXSB8fCAhdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF1bIG5hbWUgXSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFQSSBub3QgZm91bmQ6IGNvbnN0cnVjdCBuYW1lICR7YXBpQ29uc3RydWN0TmFtZX0gYW5kIG5hbWUgJHtuYW1lfWApO1xuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF1bIG5hbWUgXTtcbiAgICB9XG5cbiAgICBnZXRBUElzKGFwaUNvbnN0cnVjdE5hbWU6IHN0cmluZyk6IGFueSB7XG4gICAgICAgIHJldHVybiB0aGlzLmFwaXNbIGFwaUNvbnN0cnVjdE5hbWUgXTtcbiAgICB9XG5cbiAgICBoYXNJbXBvcnRlZEFQSShhcGlDb25zdHJ1Y3ROYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICAgICAgaWYgKCF0aGlzLmFwaXNbIGFwaUNvbnN0cnVjdE5hbWUgXSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgYW55IEFQSSBpbiBhbnkgc3RhY2sgaXMgbWFya2VkIGFzIGltcG9ydGVkXG4gICAgICAgIHJldHVybiBPYmplY3QudmFsdWVzKHRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdKVxuICAgICAgICAgICAgLnNvbWUoYXBpID0+IGFwaS5pc0ltcG9ydGVkID09PSB0cnVlKTtcbiAgICB9XG5cbiAgICBhZGRNb2R1bGUobmFtZTogc3RyaW5nLCBtb2R1bGU6IElGdzI0TW9kdWxlKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiYWRkTW9kdWxlOlwiLCB7IG5hbWUsIG1vZHVsZTogbW9kdWxlLmdldEJhc2VQYXRoKCkgfSk7XG5cbiAgICAgICAgLy8gY29sbGVjdCBhbGwgZXhwb3J0ZWQgcG9saWNpZXMgZnJvbSB0aGlzIG1vZHVsZVxuICAgICAgICBmb3IgKGNvbnN0IFsgcG9saWN5TmFtZSwgcG9saWN5IF0gb2YgbW9kdWxlLmdldEV4cG9ydGVkUG9saWNpZXMoKSkge1xuICAgICAgICAgICAgdGhpcy5zZXRQb2xpY3kocG9saWN5TmFtZSwgcG9saWN5LCBtb2R1bGUuZ2V0TmFtZSgpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGFkZCBhbGwgZXhwb3J0ZWQgc3RhdGljIGVudiB2YWx1ZXMgaW50byB0aGUgRlcyNCBzY29wZVxuICAgICAgICBmb3IgKGNvbnN0IFsgZW52TmFtZSwgZW52VmFsdWUgXSBvZiBtb2R1bGUuZ2V0RXhwb3J0ZWRFbnZpcm9ubWVudFZhcmlhYmxlcygpKSB7XG4gICAgICAgICAgICB0aGlzLnNldEVudmlyb25tZW50VmFyaWFibGUoZW52TmFtZSwgZW52VmFsdWUsIG1vZHVsZS5nZXROYW1lKCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5tb2R1bGVzLnNldChuYW1lLCBtb2R1bGUpO1xuICAgIH1cblxuICAgIGdldE1vZHVsZXMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm1vZHVsZXNcbiAgICB9XG5cbiAgICBoYXNNb2R1bGVzKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5tb2R1bGVzLnNpemUgPiAwO1xuICAgIH1cblxuICAgIGdldFVuaXF1ZU5hbWUobmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBgJHtuYW1lfS0ke3RoaXMuY29uZmlnLm5hbWV9LSR7dGhpcy5jb25maWcuZW52aXJvbm1lbnQgfHwgJ2Vudid9LSR7dGhpcy5jb25maWcuYWNjb3VudH1gO1xuICAgIH1cblxuICAgIGdldEFybih0eXBlOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiBgYXJuOmF3czoke3R5cGV9OiR7dGhpcy5jb25maWcucmVnaW9ufToke3RoaXMuY29uZmlnLmFjY291bnR9OiR7bmFtZX1gO1xuICAgIH1cblxuICAgIHNldENvZ25pdG9BdXRob3JpemVyKG5hbWU6IHN0cmluZywgYXV0aG9yaXplcjogSUF1dGhvcml6ZXIsIGRlZmF1bHRBdXRob3JpemVyOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJzZXRDb2duaXRvQXV0aG9yaXplcjogXCIsIHsgbmFtZSwgYXV0aG9yaXplcjogYXV0aG9yaXplci5hdXRob3JpemVySWQsIGRlZmF1bHRBdXRob3JpemVyIH0pO1xuXG4gICAgICAgIHRoaXMuY29nbml0b0F1dGhvcml6ZXJzWyBuYW1lIF0gPSBhdXRob3JpemVyO1xuICAgICAgICAvLyBJZiB0aGlzIGF1dGhvcml6ZXIgaXMgdGhlIGRlZmF1bHQsIHNldCBpdCBhcyB0aGUgZGVmYXVsdCBhdXRob3JpemVyXG4gICAgICAgIGlmIChkZWZhdWx0QXV0aG9yaXplciAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHRoaXMuZGVmYXVsdEF1dGhvcml6ZXIgPSBhdXRob3JpemVyO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0Q29nbml0b0F1dGhvcml6ZXIobmFtZT86IHN0cmluZyk6IElBdXRob3JpemVyIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcImdldENvZ25pdG9BdXRob3JpemVyOiBcIiwgeyBuYW1lIH0pO1xuICAgICAgICAvLyBJZiBubyBuYW1lIGlzIHByb3ZpZGVkIGFuZCBubyBkZWZhdWx0IGF1dGhvcml6ZXIgaXMgc2V0LCB0aHJvdyBhbiBlcnJvclxuICAgICAgICBpZiAobmFtZSA9PT0gdW5kZWZpbmVkICYmIHRoaXMuZGVmYXVsdEF1dGhvcml6ZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBBdXRob3JpemVyIGV4aXN0cyBmb3IgY29nbml0byB1c2VyIHBvb2xzLiBGb3IgcG9saWN5IGJhc2VkIGF1dGhlbnRpY2F0aW9uLCB1c2UgQVdTX0lBTSBhdXRob3Jpc2VyLicpO1xuICAgICAgICB9XG4gICAgICAgIC8vIElmIG5vIG5hbWUgaXMgcHJvdmlkZWQsIHJldHVybiB0aGUgZGVmYXVsdCBhdXRob3JpemVyXG4gICAgICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmRlZmF1bHRBdXRob3JpemVyO1xuICAgICAgICB9XG4gICAgICAgIC8vIGlmIGF1dGhvcml6ZXIgd2l0aCBuYW1lIGlzIG5vdCBmb3VuZCwgdGhyb3cgYW4gZXJyb3JcbiAgICAgICAgaWYgKHRoaXMuY29nbml0b0F1dGhvcml6ZXJzWyBuYW1lIF0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdXRob3JpemVyIHdpdGggbmFtZTogJHtuYW1lfSBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBJZiBhIG5hbWUgaXMgcHJvdmlkZWQsIHJldHVybiB0aGUgYXV0aG9yaXplciB3aXRoIHRoYXQgbmFtZVxuICAgICAgICByZXR1cm4gdGhpcy5jb2duaXRvQXV0aG9yaXplcnNbIG5hbWUgXTtcbiAgICB9XG5cbiAgICBnZXRBdXRob3JpemVyKGF1dGhvcml6YXRpb25UeXBlOiBzdHJpbmcsIG5hbWU/OiBzdHJpbmcpOiBJQXV0aG9yaXplciB8IHVuZGVmaW5lZCB7XG4gICAgICAgIGlmIChhdXRob3JpemF0aW9uVHlwZSA9PT0gXCJDT0dOSVRPX1VTRVJfUE9PTFNcIikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0Q29nbml0b0F1dGhvcml6ZXIobmFtZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGF1dGhvcml6YXRpb25UeXBlID09PSBcIkpXVFwiKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRKd3RBdXRob3JpemVyKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBzZXREZWZhdWx0Q29nbml0b0F1dGhvcml6ZXJOYW1lKG5hbWU6IHN0cmluZykge1xuICAgICAgICB0aGlzLnNldEVudmlyb25tZW50VmFyaWFibGUoJ2RlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUnLCBuYW1lLCAnY29nbml0bycpO1xuICAgIH1cblxuICAgIGdldERlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUoJ2RlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUnLCAnY29nbml0bycpO1xuICAgIH1cblxuICAgIHNldEVudmlyb25tZW50VmFyaWFibGUobmFtZTogc3RyaW5nLCB2YWx1ZTogYW55LCBwcmVmaXg6IHN0cmluZyA9ICcnKSB7XG4gICAgICAgIHRoaXMuZW52aXJvbm1lbnRWYXJpYWJsZXNbIGVuc3VyZVZhbGlkRW52S2V5KG5hbWUsIHByZWZpeCkgXSA9IHZhbHVlO1xuICAgIH1cblxuICAgIGdldEVudmlyb25tZW50VmFyaWFibGUobmFtZTogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyA9ICcnLCBzY29wZT86IGFueSk6IGFueSB7XG4gICAgICAgIC8vIGlmIGxvb2t1cCBpcyBmb3IgY29uc3RydWN0IG91dHB1dCAoYmFzZWQgb24gcHJlZml4IGJlaW5nIG9uZSBvZiB0aGUgb3V0cHV0IHR5cGVzKVxuICAgICAgICAvLyBhbmQgdGhlIGFwcGxpY2F0aW9uIGhhcyBtdWx0aXBsZSBzdGFja3MsIHRoZW4gbG9vayBmb3IgdmFsdWUgaW4gdGhlIHN0YWNrIGV4cG9ydFxuICAgICAgICAvLyBpZiB0aGUgc2NvcGUgaXMgZGVmaW5lZCBhbmQgaXMgYSBzdGFjayBhbmQgdGhlIG91dHB1dCBpcyBmcm9tIHRoZSBzYW1lIHN0YWNrLCB0aGVuIHJldHVybiB0aGUgdmFsdWVcblxuICAgICAgICBpZiAocHJlZml4Lmxlbmd0aCA+IDAgJiYgc2NvcGUgJiYgc2NvcGUgaW5zdGFuY2VvZiBTdGFjayAmJiB0aGlzLnVzZU11bHRpU3RhY2tTZXR1cCgpKSB7XG4gICAgICAgICAgICBjb25zdCBpc1ByZWZpeE91dHB1dFR5cGUgPSBPYmplY3QudmFsdWVzKE91dHB1dFR5cGUpLmluY2x1ZGVzKHByZWZpeC5zcGxpdCgnXycpWyAwIF0gYXMgT3V0cHV0VHlwZSk7XG4gICAgICAgICAgICBpZiAoaXNQcmVmaXhPdXRwdXRUeXBlKSB7XG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIFNTTSBwYXJhbWV0ZXIgcmVmZXJlbmNlXG4gICAgICAgICAgICAgICAgLy8gbWFrZSBzdXJlIHRoZSBrZXkgaXMgc3BlY2lmaWVkIGFzIHF1YWxpZmllZCBrZXkgaS5lLiBrZXlfZXhwb3J0VmFsdWVLZXlcbiAgICAgICAgICAgICAgICAvLyBpdCBpcyBwb3NzaWJsZSB0aGF0IHRoZSBrZXkgaXMgbm90IHF1YWxpZmllZCBpZiB0aGUgcHJlZml4IGhhcyBvdXRwdXQgdHlwZSBhbmQga2V5IG5hbWUuIGllLiBwcmVmaXg6IHVzZXJwb29sX2F1dGhtb2R1bGUsIGtleTogdXNlclBvb2xJZFxuICAgICAgICAgICAgICAgIGlmICghbmFtZS5pbmNsdWRlcygnXycpICYmICFwcmVmaXguaW5jbHVkZXMoJ18nKSkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEVudmlyb25tZW50IHZhcmlhYmxlICR7bmFtZX0gaXMgbm90IGEgcXVhbGlmaWVkIGtleS4gUGxlYXNlIHNwZWNpZnkgYXMga2V5X2V4cG9ydFZhbHVlS2V5LiBlLmcuIHJlc3RBUElfcmVzdEFwaUlkYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvbnN0IHNzbUtleSA9IHRoaXMuZW52aXJvbm1lbnRWYXJpYWJsZXNbIGVuc3VyZVZhbGlkRW52S2V5KG5hbWUsIGBTU006JHtwcmVmaXh9YCkgXTtcblxuICAgICAgICAgICAgICAgIGlmIChzc21LZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhY2tOYW1lID0gc3NtS2V5LnNwbGl0KCcvJylbIDEgXTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENoZWNraW5nIGlmIG11bHRpLXN0YWNrIHNldHVwIHNob3VsZCBiZSB1c2VkIGZvciBlbnZpcm9ubWVudCB2YXJpYWJsZTogJHtlbnN1cmVWYWxpZEVudktleShuYW1lLCBwcmVmaXgpfSBpbiBzdGFjazogJHtzdGFja05hbWV9IGNhbGxlZCBmcm9tIHN0YWNrOiAke3Njb3BlLnN0YWNrTmFtZX0gLSAke3RoaXMudXNlTXVsdGlTdGFja1NldHVwKHN0YWNrTmFtZSwgc2NvcGUpfWApO1xuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy51c2VNdWx0aVN0YWNrU2V0dXAoc3RhY2tOYW1lLCBzY29wZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEFkZCBjcm9zcy1zdGFjayBkZXBlbmRlbmN5XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzb3VyY2VTdGFjayA9IHRoaXMuc3RhY2tzWyBzdGFja05hbWUgXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzb3VyY2VTdGFjaykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjb3BlLmFkZERlcGVuZGVuY3koc291cmNlU3RhY2spO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRlZCBkZXBlbmRlbmN5IGZyb20gJHtzY29wZS5zdGFja05hbWV9IHRvICR7c3RhY2tOYW1lfSBmb3IgU1NNIGtleTogJHtzc21LZXl9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBdHRlbXB0aW5nIHRvIGltcG9ydCBTU00gdmFsdWUgZm9yIGtleTogJHtzc21LZXl9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFN0cmluZ1BhcmFtZXRlci52YWx1ZUZvclN0cmluZ1BhcmFtZXRlcihzY29wZSwgc3NtS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gU1NNIGtleSBmb3VuZCBpbiBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIGtleTogJHtlbnN1cmVWYWxpZEVudktleShuYW1lLCBgU1NNOiR7cHJlZml4fWApfSwgdXNpbmcgZGlyZWN0IHJlZmVyZW5jZWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmVudmlyb25tZW50VmFyaWFibGVzWyBlbnN1cmVWYWxpZEVudktleShuYW1lLCBwcmVmaXgpIF07XG4gICAgfVxuXG4gICAgaGFzRW52aXJvbm1lbnRWYXJpYWJsZShuYW1lOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nID0gJycpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIChlbnN1cmVWYWxpZEVudktleShuYW1lLCBwcmVmaXgpIGluIHRoaXMuZW52aXJvbm1lbnRWYXJpYWJsZXMpO1xuICAgIH1cblxuICAgIHJlc29sdmVFbnZWYXJpYWJsZXMgPSAoZW52OiBJTGFtYmRhRW52Q29uZmlnW10gPSBbXSwgc2NvcGU/OiBhbnkpID0+IHtcbiAgICAgICAgY29uc3QgcmVzb2x2ZWQ6IGFueSA9IHt9O1xuICAgICAgICBmb3IgKGNvbnN0IGVudkNvbmZpZyBvZiBlbnYpIHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gZW52Q29uZmlnLnZhbHVlID8/IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShlbnZDb25maWcubmFtZSwgZW52Q29uZmlnLnByZWZpeCwgc2NvcGUpO1xuICAgICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZWRbIGVudkNvbmZpZy5leHBvcnROYW1lID8/IGVudkNvbmZpZy5uYW1lIF0gPSB2YWx1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgRW52aXJvbm1lbnQgdmFyaWFibGUgW3ByZWZpeDogJHtlbnZDb25maWcucHJlZml4fV0gJHtlbnZDb25maWcubmFtZX0gbm90IGZvdW5kIGluIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc29sdmVkO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIHZhbHVlIGZvciB0aGUgZ2l2ZW4gdGVtcGxhdGUgZnJvbSB0aGUgRncyNC1zY29wZSBlbnYgaWYgaXQgZm9sbG93cyB0aGUgY29udmVudGlvbnMgbGlrZSBgZW52Onh4eDp5eXlgLCBgZW52Onl5eWAuXG4gICAgICogXG4gICAgICogQHBhcmFtIGtleVRlbXBsYXRlIC0gVGhlIHRlbXBsYXRlIGZvciB0aGUgZW52aXJvbm1lbnQga2V5IHRvIHJlc29sdmUuXG4gICAgICogIGUuZy4gZW52OlVzZXJzX1RhYmxlX25hbWUsIGVudjp1c2VyTW9kdWxlOlVzZXJzX1RhYmxlX25hbWVcbiAgICAgKiBAcmV0dXJucyBUaGUgcmVzb2x2ZWQgdmFsdWUgZm9yIHRoZSBrZXkuXG4gICAgICovXG4gICAgdHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlID0gKGtleVRlbXBsYXRlOiBzdHJpbmcpID0+IHtcbiAgICAgICAgaWYgKGtleVRlbXBsYXRlLnN0YXJ0c1dpdGgoJ2VudjonKSkge1xuICAgICAgICAgICAgLy8gZW52OnVzZXJNb2R1bGU6VXNlcnNfVGFibGVfbmFtZSA9PiBbJ2VudicsICd1c2VyTW9kdWxlJywgJ1VzZXJzX1RhYmxlX25hbWUnXTtcbiAgICAgICAgICAgIGNvbnN0IHBhcnRzID0ga2V5VGVtcGxhdGUuc3BsaXQoJzonKTtcblxuICAgICAgICAgICAgLy8gZ2V0IHRoZSBhY3R1YWwgdmFsdWUgZnJvbSB0aGUgZncyNCBzY29wZSA9PT4gZncyNC5nZXQoJ1VzZXJzX1RhYmxlX25hbWUnLCAndXNlck1vZHVsZScpO1xuICAgICAgICAgICAga2V5VGVtcGxhdGUgPSBwYXJ0cy5sZW5ndGggPT09IDMgPyB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUocGFydHNbIDIgXSwgcGFydHNbIDEgXSkgOiB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUocGFydHNbIDEgXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGtleVRlbXBsYXRlO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNldCBhIGdsb2JhbCBlbnZpcm9ubWVudCB2YXJpYWJsZS4gVGhpcyB2YXJpYWJsZSB3aWxsIGJlIGF2YWlsYWJsZSB0byBhbGwgbGFtYmRhIGZ1bmN0aW9ucy5cbiAgICAgKiBAcGFyYW0gbmFtZSBUaGUgbmFtZSBvZiB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUuXG4gICAgICogQHBhcmFtIHZhbHVlIFRoZSB2YWx1ZSBvZiB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUuXG4gICAgICovXG4gICAgc2V0R2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZShuYW1lOiBzdHJpbmcsIHZhbHVlOiBhbnkpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcInNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGU6XCIsIG5hbWUsIHZhbHVlKTtcbiAgICAgICAgdGhpcy5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKG5hbWUsIHZhbHVlLCAnJyk7XG4gICAgICAgIHRoaXMuZ2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMucHVzaChlbnN1cmVWYWxpZEVudktleShuYW1lLCAnJykpO1xuICAgIH1cblxuICAgIGdldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKCk6IHN0cmluZ1tdIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXM7XG4gICAgfVxuXG4gICAgc2V0UG9saWN5KHBvbGljeU5hbWU6IHN0cmluZywgdmFsdWU6IFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50LCBwcmVmaXg6IHN0cmluZyA9ICcnKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwic2V0UG9saWN5OlwiLCBwcmVmaXgsIHBvbGljeU5hbWUsIHZhbHVlKTtcbiAgICAgICAgdGhpcy5wb2xpY3lTdGF0ZW1lbnRzLnNldChlbnN1cmVWYWxpZEVudktleShwb2xpY3lOYW1lLCBwcmVmaXgpLCB2YWx1ZSk7XG4gICAgfVxuXG4gICAgZ2V0UG9saWN5KHBvbGljeU5hbWU6IHN0cmluZywgcHJlZml4OiBzdHJpbmcgPSAnJyk6IFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50IHwgdW5kZWZpbmVkIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucG9saWN5U3RhdGVtZW50cy5nZXQoZW5zdXJlVmFsaWRFbnZLZXkocG9saWN5TmFtZSwgcHJlZml4KSk7XG4gICAgfVxuXG4gICAgaGFzUG9saWN5KHBvbGljeU5hbWU6IHN0cmluZywgcHJlZml4OiBzdHJpbmcgPSAnJyk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gdGhpcy5wb2xpY3lTdGF0ZW1lbnRzLmhhcyhlbnN1cmVWYWxpZEVudktleShwb2xpY3lOYW1lLCBwcmVmaXgpKTtcbiAgICB9XG5cbiAgICAvLyBzZXQgdGhlIG91dHB1dCBvZiBhIGNvbnN0cnVjdFxuICAgIC8vIGlmIGV4cG9ydFZhbHVlQWxpYXMgaXMgbm90IHByb3ZpZGVkLCB0aGUgZXhwb3J0IHZhbHVlIGtleSB3aWxsIGJlIHVzZWQgYXMgdGhlIGVudmlyb25tZW50IHZhcmlhYmxlIGtleS4gaS5lIHdoZW4gdXNpbmcgY3VzdG9tIHJlc291cmNlIGxpa2UgQ2ZuSWRlbnRpdHlQb29sIFxuICAgIC8vIHRoZSBvdXRwdXQgaXMgdGhlIHJlZmVyZW5jZSB0byB0aGUgY3VzdG9tIHJlc291cmNlLiBUaGUgcmVmZXJlbmNlIGlzIG5vdCB0aGUgcGh5c2ljYWwgaWQgb2YgdGhlIGN1c3RvbSByZXNvdXJjZSwgYnV0IGEgbG9naWNhbCBpZFxuICAgIC8vIHRoYXQgaXMgcmVzb2x2ZWQgdG8gdGhlIHBoeXNpY2FsIGlkIGF0IHJ1bnRpbWUuIEluIHRoaXMgY2FzZSwgdGhlIGV4cG9ydFZhbHVlQWxpYXMgaXMgdGhlIGtleSBuYW1lIG9mIHRoZSBjdXN0b20gcmVzb3VyY2UuXG4gICAgc2V0Q29uc3RydWN0T3V0cHV0KGNvbnN0cnVjdDogRlcyNENvbnN0cnVjdCwga2V5OiBzdHJpbmcsIHZhbHVlOiBhbnksIG91dHB1dFR5cGU/OiBPdXRwdXRUeXBlLCBleHBvcnRWYWx1ZUtleT86IHN0cmluZywgZXhwb3J0VmFsdWVBbGlhcz86IHN0cmluZykge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgc2V0Q29uc3RydWN0T3V0cHV0OiAke2NvbnN0cnVjdC5uYW1lfWAsIHsgb3V0cHV0VHlwZSwga2V5IH0pO1xuICAgICAgICBpZiAob3V0cHV0VHlwZSkge1xuICAgICAgICAgICAgY29uc3RydWN0Lm91dHB1dCA9IHtcbiAgICAgICAgICAgICAgICAuLi5jb25zdHJ1Y3Qub3V0cHV0LFxuICAgICAgICAgICAgICAgIFsgb3V0cHV0VHlwZSBdOiB7XG4gICAgICAgICAgICAgICAgICAgIC4uLmNvbnN0cnVjdC5vdXRwdXQ/Llsgb3V0cHV0VHlwZSBdLFxuICAgICAgICAgICAgICAgICAgICBbIGtleSBdOiB2YWx1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShrZXksIHZhbHVlLCBgJHtjb25zdHJ1Y3QubmFtZX1fJHtvdXRwdXRUeXBlfWApO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHNldEVudmlyb25tZW50VmFyaWFibGU6ICR7a2V5fWAsIHsgcHJlZml4OiBgJHtjb25zdHJ1Y3QubmFtZX1fJHtvdXRwdXRUeXBlfWAgfSk7XG5cbiAgICAgICAgICAgIC8vIGluIGNhc2Ugb2Ygb2JqZWN0IHJlZmVyZW5jZSwgZXhwb3J0IHRoZSBvdXRwdXQgdG8gYmUgdXNlZCBpbiBvdGhlciBzdGFja3NcbiAgICAgICAgICAgIGxldCBvdXRwdXRWYWx1ZSA9IHZhbHVlO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgZXhwb3J0VmFsdWVLZXkpIHtcbiAgICAgICAgICAgICAgICBvdXRwdXRWYWx1ZSA9IHZhbHVlWyBleHBvcnRWYWx1ZUtleSBdO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIGV4cG9ydFZhbHVlS2V5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENyZWF0ZSBDbG91ZEZvcm1hdGlvbiBleHBvcnQgd2l0aCB2YWxpZCBuYW1pbmdcbiAgICAgICAgICAgIGNvbnN0IHNhbml0aXplZEtleSA9IGVuc3VyZVZhbGlkRW52S2V5KGtleSwgJycsICcnLCB0cnVlKTtcbiAgICAgICAgICAgIGNvbnN0IGV4cG9ydEtleSA9IGAke291dHB1dFR5cGV9JHtzYW5pdGl6ZWRLZXl9JHtleHBvcnRWYWx1ZUFsaWFzIHx8IGV4cG9ydFZhbHVlS2V5fWA7XG4gICAgICAgICAgICBjb25zdCBzdGFja0V4cG9ydE5hbWUgPSBgJHtjb25zdHJ1Y3QubWFpblN0YWNrLnN0YWNrTmFtZX0tJHtleHBvcnRLZXl9YDtcblxuICAgICAgICAgICAgbmV3IENmbk91dHB1dChjb25zdHJ1Y3QubWFpblN0YWNrLCBleHBvcnRLZXksIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogb3V0cHV0VmFsdWUsXG4gICAgICAgICAgICAgICAgZXhwb3J0TmFtZTogc3RhY2tFeHBvcnROYW1lLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIHNldCB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUgZm9yIHRoZSBkaXJlY3QgcmVmZXJlbmNlXG4gICAgICAgICAgICB0aGlzLnNldEVudmlyb25tZW50VmFyaWFibGUoYCR7a2V5fV8ke2V4cG9ydFZhbHVlQWxpYXMgfHwgZXhwb3J0VmFsdWVLZXl9YCwgb3V0cHV0VmFsdWUsIG91dHB1dFR5cGUpO1xuICAgICAgICAgICAgLy8gU3RvcmUgU1NNIHBhcmFtZXRlciBmb3IgY3Jvc3Mtc3RhY2sgcmVmZXJlbmNlXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgdXNlTXVsdGlTdGFja1NldHVwOiAke3RoaXMudXNlTXVsdGlTdGFja1NldHVwKCl9YCk7XG4gICAgICAgICAgICBpZiAodGhpcy51c2VNdWx0aVN0YWNrU2V0dXAoKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNzbUtleSA9IGAvJHtjb25zdHJ1Y3QubWFpblN0YWNrLnN0YWNrTmFtZX0vJHtvdXRwdXRUeXBlfS8ke3Nhbml0aXplZEtleX0vJHtleHBvcnRWYWx1ZUFsaWFzIHx8IGV4cG9ydFZhbHVlS2V5fWA7XG4gICAgICAgICAgICAgICAgLy8gc2V0IHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdGhlIGNyb3NzLXN0YWNrIHJlZmVyZW5jZSB1c2luZyBTU00gcGFyYW1ldGVyXG4gICAgICAgICAgICAgICAgdGhpcy5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGAke2tleX1fJHtleHBvcnRWYWx1ZUFsaWFzIHx8IGV4cG9ydFZhbHVlS2V5fWAsIHNzbUtleSwgYFNTTToke291dHB1dFR5cGV9YCk7XG4gICAgICAgICAgICAgICAgbmV3IFN0cmluZ1BhcmFtZXRlcihjb25zdHJ1Y3QubWFpblN0YWNrLCBgU1NNJHtvdXRwdXRUeXBlfSR7c2FuaXRpemVkS2V5fSR7ZXhwb3J0VmFsdWVBbGlhcyB8fCBleHBvcnRWYWx1ZUtleX1gLCB7XG4gICAgICAgICAgICAgICAgICAgIHBhcmFtZXRlck5hbWU6IHNzbUtleSxcbiAgICAgICAgICAgICAgICAgICAgc3RyaW5nVmFsdWU6IG91dHB1dFZhbHVlLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdHJ1Y3Qub3V0cHV0ID0ge1xuICAgICAgICAgICAgICAgIC4uLmNvbnN0cnVjdC5vdXRwdXQsXG4gICAgICAgICAgICAgICAgWyBrZXkgXTogdmFsdWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShrZXksIHZhbHVlLCBjb25zdHJ1Y3QubmFtZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGREeW5hbW9UYWJsZShuYW1lOiBzdHJpbmcsIHRhYmxlOiBUYWJsZVYyKSB7XG4gICAgICAgIG5hbWUgPSBlbnN1cmVOb1NwZWNpYWxDaGFycyhuYW1lKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhZGREeW5hbW9UYWJsZTpcIiwgeyBuYW1lIH0pO1xuICAgICAgICB0aGlzLmR5bmFtb1RhYmxlc1sgbmFtZSBdID0gdGFibGU7XG4gICAgfVxuXG4gICAgZ2V0RHluYW1vVGFibGUobmFtZTogc3RyaW5nKTogVGFibGVWMiB7XG4gICAgICAgIHJldHVybiB0aGlzLmR5bmFtb1RhYmxlc1sgZW5zdXJlTm9TcGVjaWFsQ2hhcnMobmFtZSkgXTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXRzIGEgcXVldWUgcmVmZXJlbmNlIGJ5IG5hbWUsIGZvbGxvd2luZyB0aGUgZnJhbWV3b3JrJ3MgcGF0dGVybiBmb3IgZXhpc3RpbmcgcmVzb3VyY2UgcmVmZXJlbmNlcy5cbiAgICAgKiBAcGFyYW0gcXVldWVOYW1lIFRoZSBuYW1lIG9mIHRoZSBxdWV1ZVxuICAgICAqIEBwYXJhbSBzY29wZSBPcHRpb25hbCBzY29wZSBmb3Igc3RhY2sgcmVzb2x1dGlvbiBcbiAgICAgKiBAcGFyYW0gY29uc3RydWN0SWQgT3B0aW9uYWwgY29uc3RydWN0IElEIGZvciB1bmlxdWUgbmFtaW5nXG4gICAgICogQHJldHVybnMgUXVldWUgaW5zdGFuY2UgcmVmZXJlbmNlZCBieSBBUk5cbiAgICAgKi9cbiAgICBnZXRRdWV1ZUJ5TmFtZShxdWV1ZU5hbWU6IHN0cmluZywgc2NvcGU/OiBhbnksIGNvbnN0cnVjdElkPzogc3RyaW5nKTogSVF1ZXVlIHtcbiAgICAgICAgY29uc3QgcXVldWVVcmwgPSB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUocXVldWVOYW1lICsgJ19xdWV1ZU5hbWUnLCAncXVldWUnLCBzY29wZSk7XG4gICAgICAgIGNvbnN0IHF1ZXVlQXJuID0gdGhpcy5nZXRBcm4oJ3NxcycsIHF1ZXVlVXJsKTtcbiAgICAgICAgY29uc3QgdW5pcXVlSWQgPSBjb25zdHJ1Y3RJZCA/IGAke2NvbnN0cnVjdElkfS0ke3F1ZXVlTmFtZX0tcXVldWVgIDogYCR7cXVldWVOYW1lfS1xdWV1ZWA7XG4gICAgICAgIHJldHVybiBRdWV1ZS5mcm9tUXVldWVBcm4oc2NvcGUgPz8gdGhpcy5nZXRTdGFjaygpLCB1bmlxdWVJZCwgcXVldWVBcm4pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldHMgYSB0b3BpYyByZWZlcmVuY2UgYnkgbmFtZSwgZm9sbG93aW5nIHRoZSBmcmFtZXdvcmsncyBwYXR0ZXJuIGZvciBleGlzdGluZyByZXNvdXJjZSByZWZlcmVuY2VzLlxuICAgICAqIEBwYXJhbSB0b3BpY05hbWUgVGhlIG5hbWUgb2YgdGhlIHRvcGljXG4gICAgICogQHBhcmFtIHNjb3BlIE9wdGlvbmFsIHNjb3BlIGZvciBzdGFjayByZXNvbHV0aW9uXG4gICAgICogQHBhcmFtIGNvbnN0cnVjdElkIE9wdGlvbmFsIGNvbnN0cnVjdCBJRCBmb3IgdW5pcXVlIG5hbWluZyAgXG4gICAgICogQHJldHVybnMgVG9waWMgaW5zdGFuY2UgcmVmZXJlbmNlZCBieSBBUk5cbiAgICAgKi9cbiAgICBnZXRUb3BpY0J5TmFtZSh0b3BpY05hbWU6IHN0cmluZywgc2NvcGU/OiBhbnksIGNvbnN0cnVjdElkPzogc3RyaW5nKTogSVRvcGljIHtcbiAgICAgICAgY29uc3QgdG9waWNBcm5WYWx1ZSA9IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSh0b3BpY05hbWUsICd0b3BpY05hbWUnKTtcbiAgICAgICAgY29uc3QgdG9waWNBcm4gPSB0aGlzLmdldEFybignc25zJywgdG9waWNBcm5WYWx1ZSk7XG4gICAgICAgIGNvbnN0IHVuaXF1ZUlkID0gY29uc3RydWN0SWQgPyBgJHtjb25zdHJ1Y3RJZH0tJHt0b3BpY05hbWV9LXRvcGljYCA6IGAke3RvcGljTmFtZX0tdG9waWNgO1xuICAgICAgICByZXR1cm4gVG9waWMuZnJvbVRvcGljQXJuKHNjb3BlID8/IHRoaXMuZ2V0U3RhY2soKSwgdW5pcXVlSWQsIHRvcGljQXJuKTtcbiAgICB9XG5cbiAgICBhZGRSb3V0ZVRvUm9sZVBvbGljeShyb3V0ZTogc3RyaW5nLCBncm91cHM6IHN0cmluZ1tdLCByZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICAgICAgaWYgKCFncm91cHMgfHwgZ3JvdXBzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgZ3JvdXBzID0gdGhpcy5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdHcm91cHMnLCAnY29nbml0bycpO1xuICAgICAgICAgICAgaWYgKCFncm91cHMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBncm91cHMgZGVmaW5lZC4gQWRkaW5nIHJvdXRlOiAke3JvdXRlfSB0byByb2xlIHBvbGljeSBmb3IgZGVmYXVsdCBhdXRoZW50aWNhdGVkIHJvbGUuYCk7XG4gICAgICAgICAgICAgICAgZ3JvdXBzID0gWyAnZGVmYXVsdCcgXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBsZXQgcm91dGVBZGRlZFRvR3JvdXBQb2xpY3kgPSBmYWxzZTtcbiAgICAgICAgZm9yIChjb25zdCBncm91cE5hbWUgb2YgZ3JvdXBzKSB7XG4gICAgICAgICAgICAvLyBpZiByZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIGlzIHRydWUsIGNoZWNrIGlmIHRoZSByb3V0ZSBpcyBpbiB0aGUgZ3JvdXAgY29uZmlnXG4gICAgICAgICAgICBpZiAocmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyAmJiAoIXRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnUm91dGVzJywgJ2NvZ25pdG9fJyArIGdyb3VwTmFtZSkgfHwgIXRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnUm91dGVzJywgJ2NvZ25pdG9fJyArIGdyb3VwTmFtZSkuaW5jbHVkZXMocm91dGUpKSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gZ2V0IHJvbGVcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiYWRkUm91dGVUb1JvbGVQb2xpY3k6XCIsIHsgcm91dGUsIGdyb3VwTmFtZSB9KTtcbiAgICAgICAgICAgIGNvbnN0IHJvbGU6IFJvbGUgPSB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUoJ1JvbGUnLCAnY29nbml0b18nICsgZ3JvdXBOYW1lKTtcbiAgICAgICAgICAgIGlmICghcm9sZSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBSb2xlIG5vdCBmb3VuZCBmb3IgZ3JvdXA6ICR7Z3JvdXBOYW1lfS4gUm9sZSBpcyByZXF1aXJlZCB0byBhZGQgcm91dGU6ICR7cm91dGV9IHRvIHJvbGUgcG9saWN5LiBQbGVhc2UgbWFrZSBzdXJlIHlvdSBoYXZlIGEgZ3JvdXAgZGVmaW5lZCBpbiB5b3VyIGNvbmZpZyB3aXRoIHRoZSBuYW1lOiAke2dyb3VwTmFtZX0uYCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gYWRkIHJvbGUgcG9saWN5IHN0YXRlbWVudCB0byBhbGxvdyByb3V0ZSBhY2Nlc3MgZm9yIGdyb3VwXG4gICAgICAgICAgICByb2xlLmFkZFRvUG9saWN5KHRoaXMuZ2V0Um91dGVQb2xpY3lTdGF0ZW1lbnQocm91dGUpKTtcbiAgICAgICAgICAgIHJvdXRlQWRkZWRUb0dyb3VwUG9saWN5ID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXJvdXRlQWRkZWRUb0dyb3VwUG9saWN5KSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgUm91dGUgJHtyb3V0ZX0gbm90IGZvdW5kIGluIGFueSBncm91cCBjb25maWcuIFBsZWFzZSBhZGQgdGhlIHJvdXRlIHRvIGEgZ3JvdXAgY29uZmlnIHRvIHNlY3VyZSBhY2Nlc3MuYCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRSb3V0ZVBvbGljeVN0YXRlbWVudChyb3V0ZTogc3RyaW5nKSB7XG4gICAgICAgIC8vIHdyaXRlIHRoZSBwb2xpY3kgc3RhdGVtZW50XG4gICAgICAgIGNvbnN0IHN0YXRlbWVudCA9IG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBhY3Rpb25zOiBbICdleGVjdXRlLWFwaTpJbnZva2UnIF0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFsgYGFybjphd3M6ZXhlY3V0ZS1hcGk6KjoqOiovKi8qLyR7cm91dGV9YCBdLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlJvdXRlUG9saWN5U3RhdGVtZW50OlwiLCB7IHJvdXRlIH0pO1xuXG4gICAgICAgIHJldHVybiBzdGF0ZW1lbnQ7XG4gICAgfVxuXG4gICAgcHVibGljIGdldENvbnN0cnVjdE91dHB1dDxUPih0eXBlOiBPdXRwdXRUeXBlLCBuYW1lOiBzdHJpbmcpOiBUIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgLy8gTG9vayB0aHJvdWdoIGFsbCBjb25zdHJ1Y3RzIHRvIGZpbmQgdGhlIG91dHB1dFxuICAgICAgICBmb3IgKGNvbnN0IGNvbnN0cnVjdCBvZiB0aGlzLmNvbnN0cnVjdHMudmFsdWVzKCkpIHtcbiAgICAgICAgICAgIGlmIChjb25zdHJ1Y3Qub3V0cHV0Py5bIHR5cGUgXT8uWyBuYW1lIF0pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY29uc3RydWN0Lm91dHB1dFsgdHlwZSBdWyBuYW1lIF0gYXMgVDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHB1YmxpYyBhZGRDb25zdHJ1Y3QoY29uc3RydWN0OiBGVzI0Q29uc3RydWN0KSB7XG4gICAgICAgIHRoaXMuY29uc3RydWN0cy5zZXQoY29uc3RydWN0Lm5hbWUsIGNvbnN0cnVjdCk7XG4gICAgfVxuXG4gICAgcHVibGljIGdldFZwYyh2cGNOYW1lOiBzdHJpbmcpOiBWcGMge1xuICAgICAgICBjb25zdCB2cGMgPSB0aGlzLmdldENvbnN0cnVjdE91dHB1dDxWcGM+KE91dHB1dFR5cGUuVlBDLCB2cGNOYW1lKTtcbiAgICAgICAgaWYgKCF2cGMpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVlBDICR7dnBjTmFtZX0gbm90IGZvdW5kYCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHZwYztcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0SG9zdGVkWm9uZShkb21haW5OYW1lOiBzdHJpbmcpOiBJSG9zdGVkWm9uZSB7XG4gICAgICAgIC8vIExvb2sgdXAgdGhlIGhvc3RlZCB6b25lIGJ5IGRvbWFpbiBuYW1lXG4gICAgICAgIHJldHVybiBIb3N0ZWRab25lLmZyb21Mb29rdXAodGhpcy5hcHAsIGAke2RvbWFpbk5hbWV9LXpvbmVgLCB7XG4gICAgICAgICAgICBkb21haW5OYW1lLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBzZXRKd3RBdXRob3JpemVyKGF1dGhvcml6ZXI6IElBdXRob3JpemVyLCBkZWZhdWx0QXV0aG9yaXplcjogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwic2V0Snd0QXV0aG9yaXplcjogXCIsIHsgYXV0aG9yaXplcjogYXV0aG9yaXplci5hdXRob3JpemVySWQgfSk7XG4gICAgICAgIHRoaXMuand0QXV0aG9yaXplciA9IGF1dGhvcml6ZXI7XG4gICAgICAgIGlmIChkZWZhdWx0QXV0aG9yaXplcikge1xuICAgICAgICAgICAgdGhpcy5kZWZhdWx0QXV0aG9yaXplciA9IGF1dGhvcml6ZXI7XG4gICAgICAgICAgICB0aGlzLmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZSA9ICdKV1QnO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0Snd0QXV0aG9yaXplcigpOiBJQXV0aG9yaXplciB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHJldHVybiB0aGlzLmp3dEF1dGhvcml6ZXI7XG4gICAgfVxuXG4gICAgcHVibGljIHJlZ2lzdGVyU3lzdGVtQ29udHJvbGxlcihjb250cm9sbGVyOiBTeXN0ZW1Db250cm9sbGVyRGVmaW5pdGlvbikge1xuICAgICAgICB0aGlzLnN5c3RlbUNvbnRyb2xsZXJzLnNldChjb250cm9sbGVyLnBhdGgsIGNvbnRyb2xsZXIpO1xuICAgIH1cbiAgICBwdWJsaWMgaGFzU3lzdGVtQ29udHJvbGxlcihwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3lzdGVtQ29udHJvbGxlcnMuaGFzKHBhdGgpO1xuICAgIH1cbiAgICBwdWJsaWMgZ2V0U3lzdGVtQ29udHJvbGxlcihwYXRoOiBzdHJpbmcpOiBTeXN0ZW1Db250cm9sbGVyRGVmaW5pdGlvbiB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5c3RlbUNvbnRyb2xsZXJzLmdldChwYXRoKTtcbiAgICB9XG4gICAgcHVibGljIGhhc1N5c3RlbUNvbnRyb2xsZXJzKCk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gdGhpcy5zeXN0ZW1Db250cm9sbGVycy5zaXplID4gMDtcbiAgICB9XG4gICAgcHVibGljIGdldFN5c3RlbUNvbnRyb2xsZXJzKCk6IFN5c3RlbUNvbnRyb2xsZXJEZWZpbml0aW9uW10ge1xuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbSh0aGlzLnN5c3RlbUNvbnRyb2xsZXJzLnZhbHVlcygpKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgcmVnaXN0ZXJTeXN0ZW1VSUNvbmZpZyhuYW1lOiBzdHJpbmcsIGNvbmZpZzogU3lzdGVtVUlQYWdlRGVmaW5pdGlvbikge1xuICAgICAgICB0aGlzLnN5c3RlbVVJQ29uZmlncy5zZXQobmFtZSwgY29uZmlnKTtcbiAgICB9XG4gICAgcHVibGljIGhhc1N5c3RlbVVJQ29uZmlnKG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gdGhpcy5zeXN0ZW1VSUNvbmZpZ3MuaGFzKG5hbWUpO1xuICAgIH1cbiAgICBwdWJsaWMgZ2V0U3lzdGVtVUlDb25maWcobmFtZTogc3RyaW5nKTogU3lzdGVtVUlQYWdlRGVmaW5pdGlvbiB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5c3RlbVVJQ29uZmlncy5nZXQobmFtZSk7XG4gICAgfVxuICAgIHB1YmxpYyBnZXRTeXN0ZW1VSUNvbmZpZ3MoKTogU3lzdGVtVUlQYWdlRGVmaW5pdGlvbltdIHtcbiAgICAgICAgcmV0dXJuIEFycmF5LmZyb20odGhpcy5zeXN0ZW1VSUNvbmZpZ3MudmFsdWVzKCkpO1xuICAgIH1cbiAgICBwdWJsaWMgaGFzU3lzdGVtVUlDb25maWdzKCk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gdGhpcy5zeXN0ZW1VSUNvbmZpZ3Muc2l6ZSA+IDA7XG4gICAgfVxufSJdfQ==