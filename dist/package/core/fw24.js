"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Fw24 = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_route53_1 = require("aws-cdk-lib/aws-route53");
const aws_sns_1 = require("aws-cdk-lib/aws-sns");
const aws_sqs_1 = require("aws-cdk-lib/aws-sqs");
const aws_ssm_1 = require("aws-cdk-lib/aws-ssm");
const di_1 = require("../di");
const construct_1 = require("../interfaces/construct");
const logging_1 = require("../logging");
const keys_1 = require("../utils/keys");
const helper_1 = require("./helper");
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
        let stackName = name || this.getDefaultStackName();
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
        if (!this.apis[apiConstructName]?.[name]) {
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
        this.logger.debug("getCognitoAuthorizer: ", { name });
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
        this.logger.debug("setGlobalEnvironmentVariable:", name, value);
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
            if (requireRouteInGroupConfig && (!this.getEnvironmentVariable('Routes', 'cognito_' + groupName)?.includes(route))) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZncyNC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb3JlL2Z3MjQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBQWlFO0FBSWpFLGlEQUFvRztBQUNwRyx5REFBa0U7QUFFbEUsaURBQTRDO0FBQzVDLGlEQUFvRDtBQUNwRCxpREFBc0Q7QUFDdEQsOEJBQW9DO0FBR3BDLHVEQUFvRTtBQUVwRSx3Q0FBMEM7QUFDMUMsd0NBQXdFO0FBQ3hFLHFDQUFrQztBQUdsQyxNQUFhLElBQUk7SUFDSixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUUxQyxPQUFPLEdBQVcsTUFBTSxDQUFDO0lBQ3pCLGFBQWEsQ0FBTTtJQUVYLE1BQU0sR0FBdUIsRUFBRSxDQUFDO0lBQ2hDLEdBQUcsQ0FBTztJQUNWLE1BQU0sR0FBMEIsRUFBRSxDQUFDO0lBQ25DLElBQUksR0FBZ0UsRUFBRSxDQUFDO0lBQ3ZFLG9CQUFvQixHQUF3QixFQUFFLENBQUM7SUFDdEMsMEJBQTBCLEdBQWEsRUFBRSxDQUFDO0lBQzFDLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFrRCxDQUFDO0lBQ3RGLGlCQUFpQixDQUEwQjtJQUMzQyxrQkFBa0IsR0FBcUMsRUFBRSxDQUFDO0lBQzFELGFBQWEsQ0FBMEI7SUFDdkMsWUFBWSxHQUFpQyxFQUFFLENBQUM7SUFDaEQsTUFBTSxDQUFDLFFBQVEsQ0FBTztJQUViLE1BQU0sR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztJQUNuQyxNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQWtCLENBQUM7SUFDbkMsT0FBTyxHQUFHLElBQUksR0FBRyxFQUF1QixDQUFDO0lBQ3pDLFVBQVUsR0FBRyxJQUFJLEdBQUcsRUFBeUIsQ0FBQztJQUU5QyxzQkFBc0IsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO0lBQzNDLHlCQUF5QixHQUFHLElBQUksR0FBRyxFQUFrQixDQUFD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LGlCQUFpQixDQUFDLElBQUksR0FBRyxDQUFDLENBQUM7SUFDM0MsQ0FBQztJQUNNLG9CQUFvQjtRQUN2QixPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7SUFDdkQsQ0FBQztJQUVNLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxJQUFZLEVBQUUsTUFBOEI7UUFDNUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQzNDLENBQUM7SUFDTSxpQkFBaUIsQ0FBQyxJQUFZO1FBQ2pDLE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDMUMsQ0FBQztJQUNNLGlCQUFpQixDQUFDLElBQVk7UUFDakMsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMxQyxDQUFDO0lBQ00sa0JBQWtCO1FBQ3JCLE9BQU8sS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7SUFDckQsQ0FBQztJQUNNLGtCQUFrQjtRQUNyQixPQUFPLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQztJQUN6QyxDQUFDO0NBQ0o7QUFqbUJELG9CQWltQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBcHAsIENmbk91dHB1dCwgTmVzdGVkU3RhY2ssIFN0YWNrIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgSUF1dGhvcml6ZXIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyJztcbmltcG9ydCB7IFRhYmxlVjIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0IHsgVnBjIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgeyBFZmZlY3QsIFBvbGljeVN0YXRlbWVudCwgdHlwZSBQb2xpY3lTdGF0ZW1lbnRQcm9wcywgdHlwZSBSb2xlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBIb3N0ZWRab25lLCBJSG9zdGVkWm9uZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1yb3V0ZTUzJztcbmltcG9ydCB0eXBlIHsgSVRvcGljIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgeyBUb3BpYyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0IHsgSVF1ZXVlLCBRdWV1ZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zcXMnO1xuaW1wb3J0IHsgU3RyaW5nUGFyYW1ldGVyIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNzbSc7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uL2RpJztcbmltcG9ydCB7IHR5cGUgSUxhbWJkYUVudkNvbmZpZyB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgSUFwcGxpY2F0aW9uQ29uZmlnLCBTeXN0ZW1Db250cm9sbGVyRGVmaW5pdGlvbiwgU3lzdGVtVUlQYWdlRGVmaW5pdGlvbiB9IGZyb20gJy4uL2ludGVyZmFjZXMvY29uZmlnJztcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIE91dHB1dFR5cGUgfSBmcm9tICcuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdCc7XG5pbXBvcnQgeyB0eXBlIElESUNvbnRhaW5lciB9IGZyb20gJy4uL2ludGVyZmFjZXMvZGknO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBlbnN1cmVOb1NwZWNpYWxDaGFycywgZW5zdXJlVmFsaWRFbnZLZXkgfSBmcm9tICcuLi91dGlscy9rZXlzJztcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gJy4vaGVscGVyJztcbmltcG9ydCB7IHR5cGUgSUZ3MjRNb2R1bGUgfSBmcm9tICcuL3J1bnRpbWUvbW9kdWxlJztcblxuZXhwb3J0IGNsYXNzIEZ3MjQge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihGdzI0Lm5hbWUpO1xuXG4gICAgYXBwTmFtZTogc3RyaW5nID0gXCJmdzI0XCI7XG4gICAgZW1haWxQcm92aWRlcjogYW55O1xuXG4gICAgcHJpdmF0ZSBjb25maWc6IElBcHBsaWNhdGlvbkNvbmZpZyA9IHt9O1xuICAgIHByaXZhdGUgYXBwITogQXBwO1xuICAgIHByaXZhdGUgc3RhY2tzOiBSZWNvcmQ8c3RyaW5nLCBTdGFjaz4gPSB7fTtcbiAgICBwcml2YXRlIGFwaXM6IHsgWyBhcGlDb25zdHJ1Y3ROYW1lOiBzdHJpbmcgXTogeyBbIG5hbWU6IHN0cmluZyBdOiBhbnkgfSB9ID0ge307XG4gICAgcHJpdmF0ZSBlbnZpcm9ubWVudFZhcmlhYmxlczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgZ2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXM6IHN0cmluZ1tdID0gW107XG4gICAgcHJpdmF0ZSByZWFkb25seSBwb2xpY3lTdGF0ZW1lbnRzID0gbmV3IE1hcDxzdHJpbmcsIFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50PigpO1xuICAgIHByaXZhdGUgZGVmYXVsdEF1dGhvcml6ZXI6IElBdXRob3JpemVyIHwgdW5kZWZpbmVkO1xuICAgIHByaXZhdGUgY29nbml0b0F1dGhvcml6ZXJzOiB7IFsga2V5OiBzdHJpbmcgXTogSUF1dGhvcml6ZXIgfSA9IHt9O1xuICAgIHByaXZhdGUgand0QXV0aG9yaXplcjogSUF1dGhvcml6ZXIgfCB1bmRlZmluZWQ7XG4gICAgcHJpdmF0ZSBkeW5hbW9UYWJsZXM6IHsgWyBrZXk6IHN0cmluZyBdOiBUYWJsZVYyIH0gPSB7fTtcbiAgICBwcml2YXRlIHN0YXRpYyBpbnN0YW5jZTogRncyNDtcblxuICAgIHByaXZhdGUgcmVhZG9ubHkgcXVldWVzID0gbmV3IE1hcDxzdHJpbmcsIElRdWV1ZT4oKTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHRvcGljcyA9IG5ldyBNYXA8c3RyaW5nLCBJVG9waWM+KCk7XG4gICAgcHJpdmF0ZSByZWFkb25seSBtb2R1bGVzID0gbmV3IE1hcDxzdHJpbmcsIElGdzI0TW9kdWxlPigpO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY29uc3RydWN0cyA9IG5ldyBNYXA8c3RyaW5nLCBGVzI0Q29uc3RydWN0PigpO1xuXG4gICAgcHJpdmF0ZSByZWFkb25seSBnbG9iYWxMYW1iZGFMYXllck5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgcHJpdmF0ZSByZWFkb25seSBnbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2VzID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTsgLy8gcGFja2FnZSAtPiBwcmlvcml0eVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBzeXN0ZW1VSUNvbmZpZ3M6IE1hcDxzdHJpbmcsIFN5c3RlbVVJUGFnZURlZmluaXRpb24+ID0gbmV3IE1hcCgpO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgc3lzdGVtQ29udHJvbGxlcnM6IE1hcDxzdHJpbmcsIFN5c3RlbUNvbnRyb2xsZXJEZWZpbml0aW9uPiA9IG5ldyBNYXAoKTtcblxuICAgIHByaXZhdGUgY29uc3RydWN0b3IoKSB7IH0gLy8gRW1wdHkgY29uc3RydWN0b3IgYXMgQXBwIGlzIHNldCB2aWEgc2V0QXBwKClcblxuICAgIHN0YXRpYyBnZXRJbnN0YW5jZSgpOiBGdzI0IHtcbiAgICAgICAgaWYgKCFGdzI0Lmluc3RhbmNlKSB7XG4gICAgICAgICAgICBGdzI0Lmluc3RhbmNlID0gbmV3IEZ3MjQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBGdzI0Lmluc3RhbmNlO1xuICAgIH1cblxuICAgIHNldEFwcChhcHA6IEFwcCkge1xuICAgICAgICB0aGlzLmFwcCA9IGFwcDtcbiAgICB9XG5cbiAgICBnZXRBcHAoKTogQXBwIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuYXBwO1xuICAgIH1cblxuICAgIHNldENvbmZpZyhjb25maWc6IElBcHBsaWNhdGlvbkNvbmZpZykge1xuICAgICAgICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgICAgICAgLy8gSHlkcmF0ZSB0aGUgY29uZmlnIG9iamVjdCB3aXRoIGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyh0aGlzLmNvbmZpZyk7XG4gICAgICAgIC8vIFNldCB0aGUgYXBwIG5hbWVcbiAgICAgICAgdGhpcy5hcHBOYW1lID0gY29uZmlnLm5hbWUhO1xuICAgIH1cblxuICAgIGdldENvbmZpZygpOiBJQXBwbGljYXRpb25Db25maWcge1xuICAgICAgICByZXR1cm4gdGhpcy5jb25maWc7XG4gICAgfVxuXG4gICAgZ2V0QXBwRElDb250YWluZXIoKTogSURJQ29udGFpbmVyIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmFwcERJQ29udGFpbmVyIHx8IERJQ29udGFpbmVyLlJPT1Q7XG4gICAgfVxuXG4gICAgZ2V0TGFtYmRhRW50cnlQYWNrYWdlcygpOiBzdHJpbmdbXSB7XG4gICAgICAgIGlmICh0aGlzLmNvbmZpZy5sYW1iZGFFbnRyeVBhY2thZ2VzKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jb25maWcubGFtYmRhRW50cnlQYWNrYWdlcztcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gU29ydCBlbnRyeSBwYWNrYWdlcyBieSBwcmlvcml0eSAobG93ZXIgbnVtYmVyID0gbG9hZGVkIGZpcnN0KVxuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbSh0aGlzLmdsb2JhbExhbWJkYUVudHJ5UGFja2FnZXMuZW50cmllcygpKVxuICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IGFbMV0gLSBiWzFdKSAgLy8gU29ydCBieSBwcmlvcml0eVxuICAgICAgICAgICAgLm1hcCgoW3BhY2thZ2VOYW1lXSkgPT4gcGFja2FnZU5hbWUpO1xuICAgIH1cblxuICAgIGFkZEdsb2JhbExhbWJkYUVudHJ5UGFja2FnZShwYWNrYWdlTmFtZTogc3RyaW5nLCBwcmlvcml0eTogbnVtYmVyID0gOTk5KSB7XG4gICAgICAgIHRoaXMuZ2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlcy5zZXQocGFja2FnZU5hbWUsIHByaW9yaXR5KTtcbiAgICB9XG5cbiAgICBoYXNHbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2UocGFja2FnZU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5nbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2VzLmhhcyhwYWNrYWdlTmFtZSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlR2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlKHBhY2thZ2VOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5nbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2VzLmRlbGV0ZShwYWNrYWdlTmFtZSk7XG4gICAgfVxuXG4gICAgZ2V0R2xvYmFsTGFtYmRhTGF5ZXJOYW1lcygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2xvYmFsTGFtYmRhTGF5ZXJOYW1lcztcbiAgICB9XG5cbiAgICBhZGRHbG9iYWxMYW1iZGFMYXllck5hbWVzKGxheWVyTmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuZ2xvYmFsTGFtYmRhTGF5ZXJOYW1lcy5hZGQobGF5ZXJOYW1lKTtcbiAgICB9XG5cbiAgICBoYXNHbG9iYWxMYW1iZGFMYXllck5hbWVzKGxheWVyTmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdsb2JhbExhbWJkYUxheWVyTmFtZXMuaGFzKGxheWVyTmFtZSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlR2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyhsYXllck5hbWU6IHN0cmluZykge1xuICAgICAgICB0aGlzLmdsb2JhbExhbWJkYUxheWVyTmFtZXMuZGVsZXRlKGxheWVyTmFtZSk7XG4gICAgfVxuXG4gICAgYWRkU3RhY2sobmFtZTogc3RyaW5nLCBzdGFjazogYW55KTogdGhpcyB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiYWRkU3RhY2s6XCIsIHsgbmFtZSB9KTtcbiAgICAgICAgdGhpcy5zdGFja3NbIG5hbWUgXSA9IHN0YWNrO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIEdldCBhIHN0YWNrIGJ5IG5hbWUuIElmIHRoZSBzdGFjayBkb2VzIG5vdCBleGlzdCwgY3JlYXRlIGl0LlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBuYW1lIC0gVGhlIG5hbWUgb2YgdGhlIHN0YWNrIHRvIGdldC5cbiAgICAgKiBAcGFyYW0gcGFyZW50U3RhY2tOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIHBhcmVudCBzdGFjay5cbiAgICAgKiBAcmV0dXJucyBUaGUgc3RhY2suXG4gICAgICovXG4gICAgZ2V0U3RhY2sobmFtZT86IHN0cmluZywgcGFyZW50U3RhY2tOYW1lPzogc3RyaW5nKTogYW55IHtcbiAgICAgICAgbGV0IHN0YWNrTmFtZTogc3RyaW5nID0gIG5hbWUgfHwgdGhpcy5nZXREZWZhdWx0U3RhY2tOYW1lKCk7XG4gICAgICAgIC8vIGRvbid0IGFsbG93IG5lc3RlZCBzdGFja3MgaWYgbXVsdGlTdGFjayBpcyB0cnVlLCBtdWx0aXN0YWNrIGlzIHVzZWQgZm9yIGNyZWF0aW5nIGluZGVwZW5kZW50IHN0YWNrc1xuICAgICAgICBpZiAodGhpcy5jb25maWcubXVsdGlTdGFjayAmJiBwYXJlbnRTdGFja05hbWUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTmVzdGVkIHN0YWNrcyBhcmUgbm90IGFsbG93ZWQgd2hlbiBtdWx0aVN0YWNrIGlzIHRydWUuIFBsZWFzZSB1c2UgbXVsdGlTdGFjazogZmFsc2Ugb3IgcmVtb3ZlIHRoZSBwYXJlbnRTdGFja05hbWUgcGFyYW1ldGVyLicpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGlmIHRoZSBzdGFjayBkb2VzIG5vdCBleGlzdCBhbmQgbXVsdGlTdGFjayBpcyBmYWxzZSBhbmQgcGFyZW50U3RhY2tOYW1lIGlzIG5vdCBwcm92aWRlZCwgdGhlbiB1c2UgdGhlIGRlZmF1bHQgc3RhY2sgbmFtZVxuICAgICAgICBpZiAodGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdID09PSB1bmRlZmluZWQgJiYgISh0aGlzLmNvbmZpZy5tdWx0aVN0YWNrIHx8IHBhcmVudFN0YWNrTmFtZSkpIHtcbiAgICAgICAgICAgIHN0YWNrTmFtZSA9IHRoaXMuZ2V0RGVmYXVsdFN0YWNrTmFtZSgpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiR2V0dGluZyBTdGFjayBXaXRoIE5hbWU6XCIsIHsgc3RhY2tOYW1lIH0pO1xuICAgICAgICBpZiAodGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGlmIChwYXJlbnRTdGFja05hbWUpIHtcbiAgICAgICAgICAgICAgICAvLyBjcmVhdGUgYSBuZXcgbmVzdGVkIHN0YWNrXG4gICAgICAgICAgICAgICAgdGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdID0gbmV3IE5lc3RlZFN0YWNrKHRoaXMuZ2V0U3RhY2socGFyZW50U3RhY2tOYW1lKSwgc3RhY2tOYW1lKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNyZWF0ZWQgbmVzdGVkIHN0YWNrOlwiLCB7IHN0YWNrTmFtZSwgcGFyZW50U3RhY2tOYW1lIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsZXQgc3RhY2tJRCA9IGAke3RoaXMuYXBwTmFtZX0tJHtzdGFja05hbWV9LXN0YWNrYDtcbiAgICAgICAgICAgICAgICAvLyBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eSBmb3Igb2xkIHN0YWNrIG5hbWVzXG4gICAgICAgICAgICAgICAgaWYgKHN0YWNrTmFtZSA9PT0gJ3ByZW11bHRpc3RhY2snKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0YWNrSUQgPSBgJHt0aGlzLmFwcE5hbWV9LXN0YWNrYDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gY3JlYXRlIGEgbmV3IHN0YWNrXG4gICAgICAgICAgICAgICAgdGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdID0gbmV3IFN0YWNrKHRoaXMuYXBwLCBzdGFja0lELCB7XG4gICAgICAgICAgICAgICAgICAgIGVudjoge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWNjb3VudDogdGhpcy5jb25maWcuYWNjb3VudCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lvbjogdGhpcy5jb25maWcucmVnaW9uXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAvLyBtYWtlIGFsbCBzdGFja3MgZGVwZW5kZW50IG9uIHRoZSBsYXllciBzdGFja1xuICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyU3RhY2sgPSB0aGlzLmdldFN0YWNrKHRoaXMuY29uZmlnLmxheWVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgICAgICBpZiAobGF5ZXJTdGFjaykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YWNrc1sgc3RhY2tOYW1lIF0uYWRkRGVwZW5kZW5jeShsYXllclN0YWNrKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGVkIHN0YWNrOlwiLCB7IHN0YWNrTmFtZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdO1xuICAgIH1cblxuICAgIGdldERlZmF1bHRTdGFja05hbWUoKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRlZmF1bHRTdGFja05hbWUgfHwgJ21haW4nO1xuICAgIH1cblxuICAgIHVzZU11bHRpU3RhY2tTZXR1cCA9IChjdXJyZW50U3RhY2tOYW1lPzogc3RyaW5nLCByZXNvdXJjZVN0YWNrPzogU3RhY2spOiBib29sZWFuID0+IHtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgIHRoaXMuZ2V0Q29uZmlnKCkubXVsdGlTdGFja1xuICAgICAgICAgICAgJiYgdGhpcy5nZXRDb25maWcoKS5tdWx0aVN0YWNrID09PSB0cnVlXG4gICAgICAgICAgICAmJiAoXG4gICAgICAgICAgICAgICAgLy8gaWYgcmVzb3VyY2Ugc3RhY2sgaXMgbm90IHByb3ZpZGVkLCB0aGVuIG9ubHkgY2hlY2sgaWYgbXVsdGktc3RhY2sgaXMgZW5hYmxlZFxuICAgICAgICAgICAgICAgICFyZXNvdXJjZVN0YWNrIHx8XG4gICAgICAgICAgICAgICAgLy8gaWYgcmVzb3VyY2Ugc3RhY2sgaXMgcHJvdmlkZWQsIHRoZW4gY2hlY2sgaWYgaXQgaXMgYSBkaWZmZXJlbnQgc3RhY2sgdGhhbiB0aGUgY3VycmVudCBzdGFja1xuICAgICAgICAgICAgICAgICEocmVzb3VyY2VTdGFjaz8uc3RhY2tOYW1lLmVuZHNXaXRoKGN1cnJlbnRTdGFja05hbWUgKyAnLXN0YWNrJykgfHwgcmVzb3VyY2VTdGFjaz8uc3RhY2tOYW1lID09PSBjdXJyZW50U3RhY2tOYW1lKVxuICAgICAgICAgICAgKVxuICAgICAgICApIHx8IGZhbHNlO1xuICAgIH1cblxuICAgIGFkZEFQSShhcGlDb25zdHJ1Y3ROYW1lOiBzdHJpbmcsIG5hbWU6IHN0cmluZywgYXBpOiBhbnksIGlzSW1wb3J0ZWQ6IGJvb2xlYW4gPSBmYWxzZSk6IHRoaXMge1xuICAgICAgICAvLyBJbml0aWFsaXplIHRoZSBhcGlDb25zdHJ1Y3ROYW1lIG9iamVjdCBpZiBpdCBkb2Vzbid0IGV4aXN0XG4gICAgICAgIGlmICghdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF0pIHtcbiAgICAgICAgICAgIHRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdID0ge307XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhZGRBUEk6XCIsIHsgbmFtZSB9KTtcbiAgICAgICAgdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF1bIG5hbWUgXSA9IHsgYXBpOiBhcGksIGlzSW1wb3J0ZWQ6IGlzSW1wb3J0ZWQgfTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZ2V0QVBJKGFwaUNvbnN0cnVjdE5hbWU6IHN0cmluZywgbmFtZTogc3RyaW5nKTogYW55IHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgQVBJIGV4aXN0cyBmb3IgdGhlIGdpdmVuIG5hbWUgYW5kIHN0YWNrXG4gICAgICAgIGlmICghdGhpcy5hcGlzW2FwaUNvbnN0cnVjdE5hbWVdPy5bbmFtZV0pIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBUEkgbm90IGZvdW5kOiBjb25zdHJ1Y3QgbmFtZSAke2FwaUNvbnN0cnVjdE5hbWV9IGFuZCBuYW1lICR7bmFtZX1gKTtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdWyBuYW1lIF07XG4gICAgfVxuXG4gICAgZ2V0QVBJcyhhcGlDb25zdHJ1Y3ROYW1lOiBzdHJpbmcpOiBhbnkge1xuICAgICAgICByZXR1cm4gdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF07XG4gICAgfVxuXG4gICAgaGFzSW1wb3J0ZWRBUEkoYXBpQ29uc3RydWN0TmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgICAgIGlmICghdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF0pIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIGFueSBBUEkgaW4gYW55IHN0YWNrIGlzIG1hcmtlZCBhcyBpbXBvcnRlZFxuICAgICAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyh0aGlzLmFwaXNbIGFwaUNvbnN0cnVjdE5hbWUgXSlcbiAgICAgICAgICAgIC5zb21lKGFwaSA9PiBhcGkuaXNJbXBvcnRlZCA9PT0gdHJ1ZSk7XG4gICAgfVxuXG4gICAgYWRkTW9kdWxlKG5hbWU6IHN0cmluZywgbW9kdWxlOiBJRncyNE1vZHVsZSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImFkZE1vZHVsZTpcIiwgeyBuYW1lLCBtb2R1bGU6IG1vZHVsZS5nZXRCYXNlUGF0aCgpIH0pO1xuXG4gICAgICAgIC8vIGNvbGxlY3QgYWxsIGV4cG9ydGVkIHBvbGljaWVzIGZyb20gdGhpcyBtb2R1bGVcbiAgICAgICAgZm9yIChjb25zdCBbIHBvbGljeU5hbWUsIHBvbGljeSBdIG9mIG1vZHVsZS5nZXRFeHBvcnRlZFBvbGljaWVzKCkpIHtcbiAgICAgICAgICAgIHRoaXMuc2V0UG9saWN5KHBvbGljeU5hbWUsIHBvbGljeSwgbW9kdWxlLmdldE5hbWUoKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBhZGQgYWxsIGV4cG9ydGVkIHN0YXRpYyBlbnYgdmFsdWVzIGludG8gdGhlIEZXMjQgc2NvcGVcbiAgICAgICAgZm9yIChjb25zdCBbIGVudk5hbWUsIGVudlZhbHVlIF0gb2YgbW9kdWxlLmdldEV4cG9ydGVkRW52aXJvbm1lbnRWYXJpYWJsZXMoKSkge1xuICAgICAgICAgICAgdGhpcy5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGVudk5hbWUsIGVudlZhbHVlLCBtb2R1bGUuZ2V0TmFtZSgpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubW9kdWxlcy5zZXQobmFtZSwgbW9kdWxlKTtcbiAgICB9XG5cbiAgICBnZXRNb2R1bGVzKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5tb2R1bGVzXG4gICAgfVxuXG4gICAgaGFzTW9kdWxlcygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubW9kdWxlcy5zaXplID4gMDtcbiAgICB9XG5cbiAgICBnZXRVbmlxdWVOYW1lKG5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gYCR7bmFtZX0tJHt0aGlzLmNvbmZpZy5uYW1lfS0ke3RoaXMuY29uZmlnLmVudmlyb25tZW50IHx8ICdlbnYnfS0ke3RoaXMuY29uZmlnLmFjY291bnR9YDtcbiAgICB9XG5cbiAgICBnZXRBcm4odHlwZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgICAgICByZXR1cm4gYGFybjphd3M6JHt0eXBlfToke3RoaXMuY29uZmlnLnJlZ2lvbn06JHt0aGlzLmNvbmZpZy5hY2NvdW50fToke25hbWV9YDtcbiAgICB9XG5cbiAgICBzZXRDb2duaXRvQXV0aG9yaXplcihuYW1lOiBzdHJpbmcsIGF1dGhvcml6ZXI6IElBdXRob3JpemVyLCBkZWZhdWx0QXV0aG9yaXplcjogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwic2V0Q29nbml0b0F1dGhvcml6ZXI6IFwiLCB7IG5hbWUsIGF1dGhvcml6ZXI6IGF1dGhvcml6ZXIuYXV0aG9yaXplcklkLCBkZWZhdWx0QXV0aG9yaXplciB9KTtcblxuICAgICAgICB0aGlzLmNvZ25pdG9BdXRob3JpemVyc1sgbmFtZSBdID0gYXV0aG9yaXplcjtcbiAgICAgICAgLy8gSWYgdGhpcyBhdXRob3JpemVyIGlzIHRoZSBkZWZhdWx0LCBzZXQgaXQgYXMgdGhlIGRlZmF1bHQgYXV0aG9yaXplclxuICAgICAgICBpZiAoZGVmYXVsdEF1dGhvcml6ZXIgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICB0aGlzLmRlZmF1bHRBdXRob3JpemVyID0gYXV0aG9yaXplcjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldENvZ25pdG9BdXRob3JpemVyKG5hbWU/OiBzdHJpbmcpOiBJQXV0aG9yaXplciB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiZ2V0Q29nbml0b0F1dGhvcml6ZXI6IFwiLCB7IG5hbWUgfSk7XG4gICAgICAgIC8vIElmIG5vIG5hbWUgaXMgcHJvdmlkZWQgYW5kIG5vIGRlZmF1bHQgYXV0aG9yaXplciBpcyBzZXQsIHRocm93IGFuIGVycm9yXG4gICAgICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQgJiYgdGhpcy5kZWZhdWx0QXV0aG9yaXplciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIEF1dGhvcml6ZXIgZXhpc3RzIGZvciBjb2duaXRvIHVzZXIgcG9vbHMuIEZvciBwb2xpY3kgYmFzZWQgYXV0aGVudGljYXRpb24sIHVzZSBBV1NfSUFNIGF1dGhvcmlzZXIuJyk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gSWYgbm8gbmFtZSBpcyBwcm92aWRlZCwgcmV0dXJuIHRoZSBkZWZhdWx0IGF1dGhvcml6ZXJcbiAgICAgICAgaWYgKG5hbWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGVmYXVsdEF1dGhvcml6ZXI7XG4gICAgICAgIH1cbiAgICAgICAgLy8gaWYgYXV0aG9yaXplciB3aXRoIG5hbWUgaXMgbm90IGZvdW5kLCB0aHJvdyBhbiBlcnJvclxuICAgICAgICBpZiAodGhpcy5jb2duaXRvQXV0aG9yaXplcnNbIG5hbWUgXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF1dGhvcml6ZXIgd2l0aCBuYW1lOiAke25hbWV9IG5vdCBmb3VuZGApO1xuICAgICAgICB9XG4gICAgICAgIC8vIElmIGEgbmFtZSBpcyBwcm92aWRlZCwgcmV0dXJuIHRoZSBhdXRob3JpemVyIHdpdGggdGhhdCBuYW1lXG4gICAgICAgIHJldHVybiB0aGlzLmNvZ25pdG9BdXRob3JpemVyc1sgbmFtZSBdO1xuICAgIH1cblxuICAgIGdldEF1dGhvcml6ZXIoYXV0aG9yaXphdGlvblR5cGU6IHN0cmluZywgbmFtZT86IHN0cmluZyk6IElBdXRob3JpemVyIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgaWYgKGF1dGhvcml6YXRpb25UeXBlID09PSBcIkNPR05JVE9fVVNFUl9QT09MU1wiKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRDb2duaXRvQXV0aG9yaXplcihuYW1lKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYXV0aG9yaXphdGlvblR5cGUgPT09IFwiSldUXCIpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmdldEp3dEF1dGhvcml6ZXIoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHNldERlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUobmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnZGVmYXVsdENvZ25pdG9BdXRob3JpemVyTmFtZScsIG5hbWUsICdjb2duaXRvJyk7XG4gICAgfVxuXG4gICAgZ2V0RGVmYXVsdENvZ25pdG9BdXRob3JpemVyTmFtZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnZGVmYXVsdENvZ25pdG9BdXRob3JpemVyTmFtZScsICdjb2duaXRvJyk7XG4gICAgfVxuXG4gICAgc2V0RW52aXJvbm1lbnRWYXJpYWJsZShuYW1lOiBzdHJpbmcsIHZhbHVlOiBhbnksIHByZWZpeDogc3RyaW5nID0gJycpIHtcbiAgICAgICAgdGhpcy5lbnZpcm9ubWVudFZhcmlhYmxlc1sgZW5zdXJlVmFsaWRFbnZLZXkobmFtZSwgcHJlZml4KSBdID0gdmFsdWU7XG4gICAgfVxuXG4gICAgZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShuYW1lOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nID0gJycsIHNjb3BlPzogYW55KTogYW55IHtcbiAgICAgICAgLy8gaWYgbG9va3VwIGlzIGZvciBjb25zdHJ1Y3Qgb3V0cHV0IChiYXNlZCBvbiBwcmVmaXggYmVpbmcgb25lIG9mIHRoZSBvdXRwdXQgdHlwZXMpXG4gICAgICAgIC8vIGFuZCB0aGUgYXBwbGljYXRpb24gaGFzIG11bHRpcGxlIHN0YWNrcywgdGhlbiBsb29rIGZvciB2YWx1ZSBpbiB0aGUgc3RhY2sgZXhwb3J0XG4gICAgICAgIC8vIGlmIHRoZSBzY29wZSBpcyBkZWZpbmVkIGFuZCBpcyBhIHN0YWNrIGFuZCB0aGUgb3V0cHV0IGlzIGZyb20gdGhlIHNhbWUgc3RhY2ssIHRoZW4gcmV0dXJuIHRoZSB2YWx1ZVxuXG4gICAgICAgIGlmIChwcmVmaXgubGVuZ3RoID4gMCAmJiBzY29wZSAmJiBzY29wZSBpbnN0YW5jZW9mIFN0YWNrICYmIHRoaXMudXNlTXVsdGlTdGFja1NldHVwKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGlzUHJlZml4T3V0cHV0VHlwZSA9IE9iamVjdC52YWx1ZXMoT3V0cHV0VHlwZSkuaW5jbHVkZXMocHJlZml4LnNwbGl0KCdfJylbIDAgXSBhcyBPdXRwdXRUeXBlKTtcbiAgICAgICAgICAgIGlmIChpc1ByZWZpeE91dHB1dFR5cGUpIHtcbiAgICAgICAgICAgICAgICAvLyBDaGVjayBmb3IgU1NNIHBhcmFtZXRlciByZWZlcmVuY2VcbiAgICAgICAgICAgICAgICAvLyBtYWtlIHN1cmUgdGhlIGtleSBpcyBzcGVjaWZpZWQgYXMgcXVhbGlmaWVkIGtleSBpLmUuIGtleV9leHBvcnRWYWx1ZUtleVxuICAgICAgICAgICAgICAgIC8vIGl0IGlzIHBvc3NpYmxlIHRoYXQgdGhlIGtleSBpcyBub3QgcXVhbGlmaWVkIGlmIHRoZSBwcmVmaXggaGFzIG91dHB1dCB0eXBlIGFuZCBrZXkgbmFtZS4gaWUuIHByZWZpeDogdXNlcnBvb2xfYXV0aG1vZHVsZSwga2V5OiB1c2VyUG9vbElkXG4gICAgICAgICAgICAgICAgaWYgKCFuYW1lLmluY2x1ZGVzKCdfJykgJiYgIXByZWZpeC5pbmNsdWRlcygnXycpKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRW52aXJvbm1lbnQgdmFyaWFibGUgJHtuYW1lfSBpcyBub3QgYSBxdWFsaWZpZWQga2V5LiBQbGVhc2Ugc3BlY2lmeSBhcyBrZXlfZXhwb3J0VmFsdWVLZXkuIGUuZy4gcmVzdEFQSV9yZXN0QXBpSWRgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29uc3Qgc3NtS2V5ID0gdGhpcy5lbnZpcm9ubWVudFZhcmlhYmxlc1sgZW5zdXJlVmFsaWRFbnZLZXkobmFtZSwgYFNTTToke3ByZWZpeH1gKSBdO1xuXG4gICAgICAgICAgICAgICAgaWYgKHNzbUtleSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFja05hbWUgPSBzc21LZXkuc3BsaXQoJy8nKVsgMSBdO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2hlY2tpbmcgaWYgbXVsdGktc3RhY2sgc2V0dXAgc2hvdWxkIGJlIHVzZWQgZm9yIGVudmlyb25tZW50IHZhcmlhYmxlOiAke2Vuc3VyZVZhbGlkRW52S2V5KG5hbWUsIHByZWZpeCl9IGluIHN0YWNrOiAke3N0YWNrTmFtZX0gY2FsbGVkIGZyb20gc3RhY2s6ICR7c2NvcGUuc3RhY2tOYW1lfSAtICR7dGhpcy51c2VNdWx0aVN0YWNrU2V0dXAoc3RhY2tOYW1lLCBzY29wZSl9YCk7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnVzZU11bHRpU3RhY2tTZXR1cChzdGFja05hbWUsIHNjb3BlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQWRkIGNyb3NzLXN0YWNrIGRlcGVuZGVuY3lcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNvdXJjZVN0YWNrID0gdGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNvdXJjZVN0YWNrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2NvcGUuYWRkRGVwZW5kZW5jeShzb3VyY2VTdGFjayk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGVkIGRlcGVuZGVuY3kgZnJvbSAke3Njb3BlLnN0YWNrTmFtZX0gdG8gJHtzdGFja05hbWV9IGZvciBTU00ga2V5OiAke3NzbUtleX1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEF0dGVtcHRpbmcgdG8gaW1wb3J0IFNTTSB2YWx1ZSBmb3Iga2V5OiAke3NzbUtleX1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gU3RyaW5nUGFyYW1ldGVyLnZhbHVlRm9yU3RyaW5nUGFyYW1ldGVyKHNjb3BlLCBzc21LZXkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBTU00ga2V5IGZvdW5kIGluIGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3Iga2V5OiAke2Vuc3VyZVZhbGlkRW52S2V5KG5hbWUsIGBTU006JHtwcmVmaXh9YCl9LCB1c2luZyBkaXJlY3QgcmVmZXJlbmNlYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZW52aXJvbm1lbnRWYXJpYWJsZXNbIGVuc3VyZVZhbGlkRW52S2V5KG5hbWUsIHByZWZpeCkgXTtcbiAgICB9XG5cbiAgICBoYXNFbnZpcm9ubWVudFZhcmlhYmxlKG5hbWU6IHN0cmluZywgcHJlZml4OiBzdHJpbmcgPSAnJyk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gKGVuc3VyZVZhbGlkRW52S2V5KG5hbWUsIHByZWZpeCkgaW4gdGhpcy5lbnZpcm9ubWVudFZhcmlhYmxlcyk7XG4gICAgfVxuXG4gICAgcmVzb2x2ZUVudlZhcmlhYmxlcyA9IChlbnY6IElMYW1iZGFFbnZDb25maWdbXSA9IFtdLCBzY29wZT86IGFueSkgPT4ge1xuICAgICAgICBjb25zdCByZXNvbHZlZDogYW55ID0ge307XG4gICAgICAgIGZvciAoY29uc3QgZW52Q29uZmlnIG9mIGVudikge1xuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBlbnZDb25maWcudmFsdWUgPz8gdGhpcy5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGVudkNvbmZpZy5uYW1lLCBlbnZDb25maWcucHJlZml4LCBzY29wZSk7XG4gICAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICByZXNvbHZlZFsgZW52Q29uZmlnLmV4cG9ydE5hbWUgPz8gZW52Q29uZmlnLm5hbWUgXSA9IHZhbHVlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBFbnZpcm9ubWVudCB2YXJpYWJsZSBbcHJlZml4OiAke2VudkNvbmZpZy5wcmVmaXh9XSAke2VudkNvbmZpZy5uYW1lfSBub3QgZm91bmQgaW4gdGhlIGVudmlyb25tZW50IHZhcmlhYmxlcy5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzb2x2ZWQ7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyB0aGUgdmFsdWUgZm9yIHRoZSBnaXZlbiB0ZW1wbGF0ZSBmcm9tIHRoZSBGdzI0LXNjb3BlIGVudiBpZiBpdCBmb2xsb3dzIHRoZSBjb252ZW50aW9ucyBsaWtlIGBlbnY6eHh4Onl5eWAsIGBlbnY6eXl5YC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0ga2V5VGVtcGxhdGUgLSBUaGUgdGVtcGxhdGUgZm9yIHRoZSBlbnZpcm9ubWVudCBrZXkgdG8gcmVzb2x2ZS5cbiAgICAgKiAgZS5nLiBlbnY6VXNlcnNfVGFibGVfbmFtZSwgZW52OnVzZXJNb2R1bGU6VXNlcnNfVGFibGVfbmFtZVxuICAgICAqIEByZXR1cm5zIFRoZSByZXNvbHZlZCB2YWx1ZSBmb3IgdGhlIGtleS5cbiAgICAgKi9cbiAgICB0cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUgPSAoa2V5VGVtcGxhdGU6IHN0cmluZykgPT4ge1xuICAgICAgICBpZiAoa2V5VGVtcGxhdGUuc3RhcnRzV2l0aCgnZW52OicpKSB7XG4gICAgICAgICAgICAvLyBlbnY6dXNlck1vZHVsZTpVc2Vyc19UYWJsZV9uYW1lID0+IFsnZW52JywgJ3VzZXJNb2R1bGUnLCAnVXNlcnNfVGFibGVfbmFtZSddO1xuICAgICAgICAgICAgY29uc3QgcGFydHMgPSBrZXlUZW1wbGF0ZS5zcGxpdCgnOicpO1xuXG4gICAgICAgICAgICAvLyBnZXQgdGhlIGFjdHVhbCB2YWx1ZSBmcm9tIHRoZSBmdzI0IHNjb3BlID09PiBmdzI0LmdldCgnVXNlcnNfVGFibGVfbmFtZScsICd1c2VyTW9kdWxlJyk7XG4gICAgICAgICAgICBrZXlUZW1wbGF0ZSA9IHBhcnRzLmxlbmd0aCA9PT0gMyA/IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShwYXJ0c1sgMiBdLCBwYXJ0c1sgMSBdKSA6IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShwYXJ0c1sgMSBdKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ga2V5VGVtcGxhdGU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0IGEgZ2xvYmFsIGVudmlyb25tZW50IHZhcmlhYmxlLiBUaGlzIHZhcmlhYmxlIHdpbGwgYmUgYXZhaWxhYmxlIHRvIGFsbCBsYW1iZGEgZnVuY3Rpb25zLlxuICAgICAqIEBwYXJhbSBuYW1lIFRoZSBuYW1lIG9mIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZS5cbiAgICAgKiBAcGFyYW0gdmFsdWUgVGhlIHZhbHVlIG9mIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZS5cbiAgICAgKi9cbiAgICBzZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlKG5hbWU6IHN0cmluZywgdmFsdWU6IGFueSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcInNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGU6XCIsIG5hbWUsIHZhbHVlKTtcbiAgICAgICAgdGhpcy5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKG5hbWUsIHZhbHVlLCAnJyk7XG4gICAgICAgIHRoaXMuZ2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMucHVzaChlbnN1cmVWYWxpZEVudktleShuYW1lLCAnJykpO1xuICAgIH1cblxuICAgIGdldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKCk6IHN0cmluZ1tdIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXM7XG4gICAgfVxuXG4gICAgc2V0UG9saWN5KHBvbGljeU5hbWU6IHN0cmluZywgdmFsdWU6IFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50LCBwcmVmaXg6IHN0cmluZyA9ICcnKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwic2V0UG9saWN5OlwiLCBwcmVmaXgsIHBvbGljeU5hbWUsIHZhbHVlKTtcbiAgICAgICAgdGhpcy5wb2xpY3lTdGF0ZW1lbnRzLnNldChlbnN1cmVWYWxpZEVudktleShwb2xpY3lOYW1lLCBwcmVmaXgpLCB2YWx1ZSk7XG4gICAgfVxuXG4gICAgZ2V0UG9saWN5KHBvbGljeU5hbWU6IHN0cmluZywgcHJlZml4OiBzdHJpbmcgPSAnJyk6IFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50IHwgdW5kZWZpbmVkIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucG9saWN5U3RhdGVtZW50cy5nZXQoZW5zdXJlVmFsaWRFbnZLZXkocG9saWN5TmFtZSwgcHJlZml4KSk7XG4gICAgfVxuXG4gICAgaGFzUG9saWN5KHBvbGljeU5hbWU6IHN0cmluZywgcHJlZml4OiBzdHJpbmcgPSAnJyk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gdGhpcy5wb2xpY3lTdGF0ZW1lbnRzLmhhcyhlbnN1cmVWYWxpZEVudktleShwb2xpY3lOYW1lLCBwcmVmaXgpKTtcbiAgICB9XG5cbiAgICAvLyBzZXQgdGhlIG91dHB1dCBvZiBhIGNvbnN0cnVjdFxuICAgIC8vIGlmIGV4cG9ydFZhbHVlQWxpYXMgaXMgbm90IHByb3ZpZGVkLCB0aGUgZXhwb3J0IHZhbHVlIGtleSB3aWxsIGJlIHVzZWQgYXMgdGhlIGVudmlyb25tZW50IHZhcmlhYmxlIGtleS4gaS5lIHdoZW4gdXNpbmcgY3VzdG9tIHJlc291cmNlIGxpa2UgQ2ZuSWRlbnRpdHlQb29sIFxuICAgIC8vIHRoZSBvdXRwdXQgaXMgdGhlIHJlZmVyZW5jZSB0byB0aGUgY3VzdG9tIHJlc291cmNlLiBUaGUgcmVmZXJlbmNlIGlzIG5vdCB0aGUgcGh5c2ljYWwgaWQgb2YgdGhlIGN1c3RvbSByZXNvdXJjZSwgYnV0IGEgbG9naWNhbCBpZFxuICAgIC8vIHRoYXQgaXMgcmVzb2x2ZWQgdG8gdGhlIHBoeXNpY2FsIGlkIGF0IHJ1bnRpbWUuIEluIHRoaXMgY2FzZSwgdGhlIGV4cG9ydFZhbHVlQWxpYXMgaXMgdGhlIGtleSBuYW1lIG9mIHRoZSBjdXN0b20gcmVzb3VyY2UuXG4gICAgc2V0Q29uc3RydWN0T3V0cHV0KGNvbnN0cnVjdDogRlcyNENvbnN0cnVjdCwga2V5OiBzdHJpbmcsIHZhbHVlOiBhbnksIG91dHB1dFR5cGU/OiBPdXRwdXRUeXBlLCBleHBvcnRWYWx1ZUtleT86IHN0cmluZywgZXhwb3J0VmFsdWVBbGlhcz86IHN0cmluZykge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhgc2V0Q29uc3RydWN0T3V0cHV0OiAke2NvbnN0cnVjdC5uYW1lfWAsIHsgb3V0cHV0VHlwZSwga2V5IH0pO1xuICAgICAgICBpZiAob3V0cHV0VHlwZSkge1xuICAgICAgICAgICAgY29uc3RydWN0Lm91dHB1dCA9IHtcbiAgICAgICAgICAgICAgICAuLi5jb25zdHJ1Y3Qub3V0cHV0LFxuICAgICAgICAgICAgICAgIFsgb3V0cHV0VHlwZSBdOiB7XG4gICAgICAgICAgICAgICAgICAgIC4uLmNvbnN0cnVjdC5vdXRwdXQ/Llsgb3V0cHV0VHlwZSBdLFxuICAgICAgICAgICAgICAgICAgICBbIGtleSBdOiB2YWx1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShrZXksIHZhbHVlLCBgJHtjb25zdHJ1Y3QubmFtZX1fJHtvdXRwdXRUeXBlfWApO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHNldEVudmlyb25tZW50VmFyaWFibGU6ICR7a2V5fWAsIHsgcHJlZml4OiBgJHtjb25zdHJ1Y3QubmFtZX1fJHtvdXRwdXRUeXBlfWAgfSk7XG5cbiAgICAgICAgICAgIC8vIGluIGNhc2Ugb2Ygb2JqZWN0IHJlZmVyZW5jZSwgZXhwb3J0IHRoZSBvdXRwdXQgdG8gYmUgdXNlZCBpbiBvdGhlciBzdGFja3NcbiAgICAgICAgICAgIGxldCBvdXRwdXRWYWx1ZSA9IHZhbHVlO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgZXhwb3J0VmFsdWVLZXkpIHtcbiAgICAgICAgICAgICAgICBvdXRwdXRWYWx1ZSA9IHZhbHVlWyBleHBvcnRWYWx1ZUtleSBdO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIGV4cG9ydFZhbHVlS2V5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENyZWF0ZSBDbG91ZEZvcm1hdGlvbiBleHBvcnQgd2l0aCB2YWxpZCBuYW1pbmdcbiAgICAgICAgICAgIGNvbnN0IHNhbml0aXplZEtleSA9IGVuc3VyZVZhbGlkRW52S2V5KGtleSwgJycsICcnLCB0cnVlKTtcbiAgICAgICAgICAgIGNvbnN0IGV4cG9ydEtleSA9IGAke291dHB1dFR5cGV9JHtzYW5pdGl6ZWRLZXl9JHtleHBvcnRWYWx1ZUFsaWFzIHx8IGV4cG9ydFZhbHVlS2V5fWA7XG4gICAgICAgICAgICBjb25zdCBzdGFja0V4cG9ydE5hbWUgPSBgJHtjb25zdHJ1Y3QubWFpblN0YWNrLnN0YWNrTmFtZX0tJHtleHBvcnRLZXl9YDtcblxuICAgICAgICAgICAgbmV3IENmbk91dHB1dChjb25zdHJ1Y3QubWFpblN0YWNrLCBleHBvcnRLZXksIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogb3V0cHV0VmFsdWUsXG4gICAgICAgICAgICAgICAgZXhwb3J0TmFtZTogc3RhY2tFeHBvcnROYW1lLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIHNldCB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUgZm9yIHRoZSBkaXJlY3QgcmVmZXJlbmNlXG4gICAgICAgICAgICB0aGlzLnNldEVudmlyb25tZW50VmFyaWFibGUoYCR7a2V5fV8ke2V4cG9ydFZhbHVlQWxpYXMgfHwgZXhwb3J0VmFsdWVLZXl9YCwgb3V0cHV0VmFsdWUsIG91dHB1dFR5cGUpO1xuICAgICAgICAgICAgLy8gU3RvcmUgU1NNIHBhcmFtZXRlciBmb3IgY3Jvc3Mtc3RhY2sgcmVmZXJlbmNlXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgdXNlTXVsdGlTdGFja1NldHVwOiAke3RoaXMudXNlTXVsdGlTdGFja1NldHVwKCl9YCk7XG4gICAgICAgICAgICBpZiAodGhpcy51c2VNdWx0aVN0YWNrU2V0dXAoKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNzbUtleSA9IGAvJHtjb25zdHJ1Y3QubWFpblN0YWNrLnN0YWNrTmFtZX0vJHtvdXRwdXRUeXBlfS8ke3Nhbml0aXplZEtleX0vJHtleHBvcnRWYWx1ZUFsaWFzIHx8IGV4cG9ydFZhbHVlS2V5fWA7XG4gICAgICAgICAgICAgICAgLy8gc2V0IHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdGhlIGNyb3NzLXN0YWNrIHJlZmVyZW5jZSB1c2luZyBTU00gcGFyYW1ldGVyXG4gICAgICAgICAgICAgICAgdGhpcy5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGAke2tleX1fJHtleHBvcnRWYWx1ZUFsaWFzIHx8IGV4cG9ydFZhbHVlS2V5fWAsIHNzbUtleSwgYFNTTToke291dHB1dFR5cGV9YCk7XG4gICAgICAgICAgICAgICAgbmV3IFN0cmluZ1BhcmFtZXRlcihjb25zdHJ1Y3QubWFpblN0YWNrLCBgU1NNJHtvdXRwdXRUeXBlfSR7c2FuaXRpemVkS2V5fSR7ZXhwb3J0VmFsdWVBbGlhcyB8fCBleHBvcnRWYWx1ZUtleX1gLCB7XG4gICAgICAgICAgICAgICAgICAgIHBhcmFtZXRlck5hbWU6IHNzbUtleSxcbiAgICAgICAgICAgICAgICAgICAgc3RyaW5nVmFsdWU6IG91dHB1dFZhbHVlLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdHJ1Y3Qub3V0cHV0ID0ge1xuICAgICAgICAgICAgICAgIC4uLmNvbnN0cnVjdC5vdXRwdXQsXG4gICAgICAgICAgICAgICAgWyBrZXkgXTogdmFsdWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShrZXksIHZhbHVlLCBjb25zdHJ1Y3QubmFtZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGREeW5hbW9UYWJsZShuYW1lOiBzdHJpbmcsIHRhYmxlOiBUYWJsZVYyKSB7XG4gICAgICAgIG5hbWUgPSBlbnN1cmVOb1NwZWNpYWxDaGFycyhuYW1lKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhZGREeW5hbW9UYWJsZTpcIiwgeyBuYW1lIH0pO1xuICAgICAgICB0aGlzLmR5bmFtb1RhYmxlc1sgbmFtZSBdID0gdGFibGU7XG4gICAgfVxuXG4gICAgZ2V0RHluYW1vVGFibGUobmFtZTogc3RyaW5nKTogVGFibGVWMiB7XG4gICAgICAgIHJldHVybiB0aGlzLmR5bmFtb1RhYmxlc1sgZW5zdXJlTm9TcGVjaWFsQ2hhcnMobmFtZSkgXTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXRzIGEgcXVldWUgcmVmZXJlbmNlIGJ5IG5hbWUsIGZvbGxvd2luZyB0aGUgZnJhbWV3b3JrJ3MgcGF0dGVybiBmb3IgZXhpc3RpbmcgcmVzb3VyY2UgcmVmZXJlbmNlcy5cbiAgICAgKiBAcGFyYW0gcXVldWVOYW1lIFRoZSBuYW1lIG9mIHRoZSBxdWV1ZVxuICAgICAqIEBwYXJhbSBzY29wZSBPcHRpb25hbCBzY29wZSBmb3Igc3RhY2sgcmVzb2x1dGlvbiBcbiAgICAgKiBAcGFyYW0gY29uc3RydWN0SWQgT3B0aW9uYWwgY29uc3RydWN0IElEIGZvciB1bmlxdWUgbmFtaW5nXG4gICAgICogQHJldHVybnMgUXVldWUgaW5zdGFuY2UgcmVmZXJlbmNlZCBieSBBUk5cbiAgICAgKi9cbiAgICBnZXRRdWV1ZUJ5TmFtZShxdWV1ZU5hbWU6IHN0cmluZywgc2NvcGU/OiBhbnksIGNvbnN0cnVjdElkPzogc3RyaW5nKTogSVF1ZXVlIHtcbiAgICAgICAgY29uc3QgcXVldWVVcmwgPSB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUocXVldWVOYW1lICsgJ19xdWV1ZU5hbWUnLCAncXVldWUnLCBzY29wZSk7XG4gICAgICAgIGNvbnN0IHF1ZXVlQXJuID0gdGhpcy5nZXRBcm4oJ3NxcycsIHF1ZXVlVXJsKTtcbiAgICAgICAgY29uc3QgdW5pcXVlSWQgPSBjb25zdHJ1Y3RJZCA/IGAke2NvbnN0cnVjdElkfS0ke3F1ZXVlTmFtZX0tcXVldWVgIDogYCR7cXVldWVOYW1lfS1xdWV1ZWA7XG4gICAgICAgIHJldHVybiBRdWV1ZS5mcm9tUXVldWVBcm4oc2NvcGUgPz8gdGhpcy5nZXRTdGFjaygpLCB1bmlxdWVJZCwgcXVldWVBcm4pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldHMgYSB0b3BpYyByZWZlcmVuY2UgYnkgbmFtZSwgZm9sbG93aW5nIHRoZSBmcmFtZXdvcmsncyBwYXR0ZXJuIGZvciBleGlzdGluZyByZXNvdXJjZSByZWZlcmVuY2VzLlxuICAgICAqIEBwYXJhbSB0b3BpY05hbWUgVGhlIG5hbWUgb2YgdGhlIHRvcGljXG4gICAgICogQHBhcmFtIHNjb3BlIE9wdGlvbmFsIHNjb3BlIGZvciBzdGFjayByZXNvbHV0aW9uXG4gICAgICogQHBhcmFtIGNvbnN0cnVjdElkIE9wdGlvbmFsIGNvbnN0cnVjdCBJRCBmb3IgdW5pcXVlIG5hbWluZyAgXG4gICAgICogQHJldHVybnMgVG9waWMgaW5zdGFuY2UgcmVmZXJlbmNlZCBieSBBUk5cbiAgICAgKi9cbiAgICBnZXRUb3BpY0J5TmFtZSh0b3BpY05hbWU6IHN0cmluZywgc2NvcGU/OiBhbnksIGNvbnN0cnVjdElkPzogc3RyaW5nKTogSVRvcGljIHtcbiAgICAgICAgY29uc3QgdG9waWNBcm5WYWx1ZSA9IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSh0b3BpY05hbWUsICd0b3BpY05hbWUnKTtcbiAgICAgICAgY29uc3QgdG9waWNBcm4gPSB0aGlzLmdldEFybignc25zJywgdG9waWNBcm5WYWx1ZSk7XG4gICAgICAgIGNvbnN0IHVuaXF1ZUlkID0gY29uc3RydWN0SWQgPyBgJHtjb25zdHJ1Y3RJZH0tJHt0b3BpY05hbWV9LXRvcGljYCA6IGAke3RvcGljTmFtZX0tdG9waWNgO1xuICAgICAgICByZXR1cm4gVG9waWMuZnJvbVRvcGljQXJuKHNjb3BlID8/IHRoaXMuZ2V0U3RhY2soKSwgdW5pcXVlSWQsIHRvcGljQXJuKTtcbiAgICB9XG5cbiAgICBhZGRSb3V0ZVRvUm9sZVBvbGljeShyb3V0ZTogc3RyaW5nLCBncm91cHM6IHN0cmluZ1tdLCByZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICAgICAgaWYgKCFncm91cHMgfHwgZ3JvdXBzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgZ3JvdXBzID0gdGhpcy5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdHcm91cHMnLCAnY29nbml0bycpO1xuICAgICAgICAgICAgaWYgKCFncm91cHMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBncm91cHMgZGVmaW5lZC4gQWRkaW5nIHJvdXRlOiAke3JvdXRlfSB0byByb2xlIHBvbGljeSBmb3IgZGVmYXVsdCBhdXRoZW50aWNhdGVkIHJvbGUuYCk7XG4gICAgICAgICAgICAgICAgZ3JvdXBzID0gWyAnZGVmYXVsdCcgXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBsZXQgcm91dGVBZGRlZFRvR3JvdXBQb2xpY3kgPSBmYWxzZTtcbiAgICAgICAgZm9yIChjb25zdCBncm91cE5hbWUgb2YgZ3JvdXBzKSB7XG4gICAgICAgICAgICAvLyBpZiByZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIGlzIHRydWUsIGNoZWNrIGlmIHRoZSByb3V0ZSBpcyBpbiB0aGUgZ3JvdXAgY29uZmlnXG4gICAgICAgICAgICBpZiAocmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyAmJiAoIXRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnUm91dGVzJywgJ2NvZ25pdG9fJyArIGdyb3VwTmFtZSk/LmluY2x1ZGVzKHJvdXRlKSkpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGdldCByb2xlXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImFkZFJvdXRlVG9Sb2xlUG9saWN5OlwiLCB7IHJvdXRlLCBncm91cE5hbWUgfSk7XG4gICAgICAgICAgICBjb25zdCByb2xlOiBSb2xlID0gdGhpcy5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdSb2xlJywgJ2NvZ25pdG9fJyArIGdyb3VwTmFtZSk7XG4gICAgICAgICAgICBpZiAoIXJvbGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgUm9sZSBub3QgZm91bmQgZm9yIGdyb3VwOiAke2dyb3VwTmFtZX0uIFJvbGUgaXMgcmVxdWlyZWQgdG8gYWRkIHJvdXRlOiAke3JvdXRlfSB0byByb2xlIHBvbGljeS4gUGxlYXNlIG1ha2Ugc3VyZSB5b3UgaGF2ZSBhIGdyb3VwIGRlZmluZWQgaW4geW91ciBjb25maWcgd2l0aCB0aGUgbmFtZTogJHtncm91cE5hbWV9LmApO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGFkZCByb2xlIHBvbGljeSBzdGF0ZW1lbnQgdG8gYWxsb3cgcm91dGUgYWNjZXNzIGZvciBncm91cFxuICAgICAgICAgICAgcm9sZS5hZGRUb1BvbGljeSh0aGlzLmdldFJvdXRlUG9saWN5U3RhdGVtZW50KHJvdXRlKSk7XG4gICAgICAgICAgICByb3V0ZUFkZGVkVG9Hcm91cFBvbGljeSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFyb3V0ZUFkZGVkVG9Hcm91cFBvbGljeSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFJvdXRlICR7cm91dGV9IG5vdCBmb3VuZCBpbiBhbnkgZ3JvdXAgY29uZmlnLiBQbGVhc2UgYWRkIHRoZSByb3V0ZSB0byBhIGdyb3VwIGNvbmZpZyB0byBzZWN1cmUgYWNjZXNzLmApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0Um91dGVQb2xpY3lTdGF0ZW1lbnQocm91dGU6IHN0cmluZykge1xuICAgICAgICAvLyB3cml0ZSB0aGUgcG9saWN5IHN0YXRlbWVudFxuICAgICAgICBjb25zdCBzdGF0ZW1lbnQgPSBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgYWN0aW9uczogWyAnZXhlY3V0ZS1hcGk6SW52b2tlJyBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbIGBhcm46YXdzOmV4ZWN1dGUtYXBpOio6KjoqLyovKi8ke3JvdXRlfWAgXSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJSb3V0ZVBvbGljeVN0YXRlbWVudDpcIiwgeyByb3V0ZSB9KTtcblxuICAgICAgICByZXR1cm4gc3RhdGVtZW50O1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRDb25zdHJ1Y3RPdXRwdXQ8VD4odHlwZTogT3V0cHV0VHlwZSwgbmFtZTogc3RyaW5nKTogVCB8IHVuZGVmaW5lZCB7XG4gICAgICAgIC8vIExvb2sgdGhyb3VnaCBhbGwgY29uc3RydWN0cyB0byBmaW5kIHRoZSBvdXRwdXRcbiAgICAgICAgZm9yIChjb25zdCBjb25zdHJ1Y3Qgb2YgdGhpcy5jb25zdHJ1Y3RzLnZhbHVlcygpKSB7XG4gICAgICAgICAgICBpZiAoY29uc3RydWN0Lm91dHB1dD8uWyB0eXBlIF0/LlsgbmFtZSBdKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnN0cnVjdC5vdXRwdXRbIHR5cGUgXVsgbmFtZSBdIGFzIFQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBwdWJsaWMgYWRkQ29uc3RydWN0KGNvbnN0cnVjdDogRlcyNENvbnN0cnVjdCkge1xuICAgICAgICB0aGlzLmNvbnN0cnVjdHMuc2V0KGNvbnN0cnVjdC5uYW1lLCBjb25zdHJ1Y3QpO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRWcGModnBjTmFtZTogc3RyaW5nKTogVnBjIHtcbiAgICAgICAgY29uc3QgdnBjID0gdGhpcy5nZXRDb25zdHJ1Y3RPdXRwdXQ8VnBjPihPdXRwdXRUeXBlLlZQQywgdnBjTmFtZSk7XG4gICAgICAgIGlmICghdnBjKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFZQQyAke3ZwY05hbWV9IG5vdCBmb3VuZGApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB2cGM7XG4gICAgfVxuXG4gICAgcHVibGljIGdldEhvc3RlZFpvbmUoZG9tYWluTmFtZTogc3RyaW5nKTogSUhvc3RlZFpvbmUge1xuICAgICAgICAvLyBMb29rIHVwIHRoZSBob3N0ZWQgem9uZSBieSBkb21haW4gbmFtZVxuICAgICAgICByZXR1cm4gSG9zdGVkWm9uZS5mcm9tTG9va3VwKHRoaXMuYXBwLCBgJHtkb21haW5OYW1lfS16b25lYCwge1xuICAgICAgICAgICAgZG9tYWluTmFtZSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgc2V0Snd0QXV0aG9yaXplcihhdXRob3JpemVyOiBJQXV0aG9yaXplciwgZGVmYXVsdEF1dGhvcml6ZXI6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcInNldEp3dEF1dGhvcml6ZXI6IFwiLCB7IGF1dGhvcml6ZXI6IGF1dGhvcml6ZXIuYXV0aG9yaXplcklkIH0pO1xuICAgICAgICB0aGlzLmp3dEF1dGhvcml6ZXIgPSBhdXRob3JpemVyO1xuICAgICAgICBpZiAoZGVmYXVsdEF1dGhvcml6ZXIpIHtcbiAgICAgICAgICAgIHRoaXMuZGVmYXVsdEF1dGhvcml6ZXIgPSBhdXRob3JpemVyO1xuICAgICAgICAgICAgdGhpcy5nZXRDb25maWcoKS5kZWZhdWx0QXV0aG9yaXphdGlvblR5cGUgPSAnSldUJztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldEp3dEF1dGhvcml6ZXIoKTogSUF1dGhvcml6ZXIgfCB1bmRlZmluZWQge1xuICAgICAgICByZXR1cm4gdGhpcy5qd3RBdXRob3JpemVyO1xuICAgIH1cblxuICAgIHB1YmxpYyByZWdpc3RlclN5c3RlbUNvbnRyb2xsZXIoY29udHJvbGxlcjogU3lzdGVtQ29udHJvbGxlckRlZmluaXRpb24pIHtcbiAgICAgICAgdGhpcy5zeXN0ZW1Db250cm9sbGVycy5zZXQoY29udHJvbGxlci5wYXRoLCBjb250cm9sbGVyKTtcbiAgICB9XG4gICAgcHVibGljIGhhc1N5c3RlbUNvbnRyb2xsZXIocGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5c3RlbUNvbnRyb2xsZXJzLmhhcyhwYXRoKTtcbiAgICB9XG4gICAgcHVibGljIGdldFN5c3RlbUNvbnRyb2xsZXIocGF0aDogc3RyaW5nKTogU3lzdGVtQ29udHJvbGxlckRlZmluaXRpb24gfCB1bmRlZmluZWQge1xuICAgICAgICByZXR1cm4gdGhpcy5zeXN0ZW1Db250cm9sbGVycy5nZXQocGF0aCk7XG4gICAgfVxuICAgIHB1YmxpYyBoYXNTeXN0ZW1Db250cm9sbGVycygpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3lzdGVtQ29udHJvbGxlcnMuc2l6ZSA+IDA7XG4gICAgfVxuICAgIHB1YmxpYyBnZXRTeXN0ZW1Db250cm9sbGVycygpOiBTeXN0ZW1Db250cm9sbGVyRGVmaW5pdGlvbltdIHtcbiAgICAgICAgcmV0dXJuIEFycmF5LmZyb20odGhpcy5zeXN0ZW1Db250cm9sbGVycy52YWx1ZXMoKSk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHJlZ2lzdGVyU3lzdGVtVUlDb25maWcobmFtZTogc3RyaW5nLCBjb25maWc6IFN5c3RlbVVJUGFnZURlZmluaXRpb24pIHtcbiAgICAgICAgdGhpcy5zeXN0ZW1VSUNvbmZpZ3Muc2V0KG5hbWUsIGNvbmZpZyk7XG4gICAgfVxuICAgIHB1YmxpYyBoYXNTeXN0ZW1VSUNvbmZpZyhuYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3lzdGVtVUlDb25maWdzLmhhcyhuYW1lKTtcbiAgICB9XG4gICAgcHVibGljIGdldFN5c3RlbVVJQ29uZmlnKG5hbWU6IHN0cmluZyk6IFN5c3RlbVVJUGFnZURlZmluaXRpb24gfCB1bmRlZmluZWQge1xuICAgICAgICByZXR1cm4gdGhpcy5zeXN0ZW1VSUNvbmZpZ3MuZ2V0KG5hbWUpO1xuICAgIH1cbiAgICBwdWJsaWMgZ2V0U3lzdGVtVUlDb25maWdzKCk6IFN5c3RlbVVJUGFnZURlZmluaXRpb25bXSB7XG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKHRoaXMuc3lzdGVtVUlDb25maWdzLnZhbHVlcygpKTtcbiAgICB9XG4gICAgcHVibGljIGhhc1N5c3RlbVVJQ29uZmlncygpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3lzdGVtVUlDb25maWdzLnNpemUgPiAwO1xuICAgIH1cbn0iXX0=