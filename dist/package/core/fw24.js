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
    globalPolicies = new Set();
    globalResourceAccess = {};
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
    /**
     * Add a policy statement that should be attached to ALL Lambda functions in the application.
     * This is useful for cross-cutting concerns like observability, logging, or shared resources.
     *
     * @example
     * // Add an imported policy by name
     * fw24.addGlobalPolicy('my-policy-name');
     * fw24.addGlobalPolicy('my-policy-name', 'my-prefix');
     * fw24.addGlobalPolicy({ name: 'my-policy-name', prefix: 'my-prefix', isOptional: true });
     *
     * // Add a direct policy statement
     * fw24.addGlobalPolicy(new PolicyStatement({
     *   effect: Effect.ALLOW,
     *   actions: ['s3:GetObject'],
     *   resources: ['*']
     * }));
     *
     * // Add policy statement props
     * fw24.addGlobalPolicy({
     *   effect: Effect.ALLOW,
     *   actions: ['s3:GetObject'],
     *   resources: ['*']
     * });
     *
     * @param policy The policy to add - can be a name string, TImportedPolicy, PolicyStatement, or PolicyStatementProps
     * @param prefix The prefix for imported policy name (optional, only used when policy is a string)
     * @param isOptional Whether the policy is optional (optional, only used when policy is a string)
     */
    addGlobalPolicy(policy, prefix = '', isOptional = false) {
        if (typeof policy === 'string') {
            // Treat as imported policy name for backward compatibility
            this.logger.debug("addGlobalPolicy (imported):", { name: policy, prefix, isOptional });
            this.globalPolicies.add({ name: policy, prefix, isOptional });
        }
        else {
            // Direct policy statement or PolicyStatementProps or TImportedPolicy
            this.logger.debug("addGlobalPolicy (direct):", { policy });
            this.globalPolicies.add(policy);
        }
    }
    /**
     * Get all global policies that should be attached to ALL Lambda functions.
     * @returns Set of policies (can be TPolicyStatementOrProps or TImportedPolicy)
     */
    getGlobalPolicies() {
        return this.globalPolicies;
    }
    /**
     * Set global resource access that should be applied to ALL Lambda functions.
     * This replaces any existing global resource access configuration.
     *
     * @example
     * fw24.setGlobalResourceAccess({
     *   tables: ['users-table', { name: 'orders-table', access: ['read'] }],
     *   buckets: ['assets-bucket'],
     *   queues: ['notifications-queue'],
     *   topics: ['events-topic']
     * });
     *
     * @param resourceAccess The resource access configuration
     */
    setGlobalResourceAccess(resourceAccess) {
        this.logger.debug("setGlobalResourceAccess:", resourceAccess);
        this.globalResourceAccess = resourceAccess;
    }
    /**
     * Add to global resource access configuration.
     * This merges with existing global resource access configuration.
     *
     * @example
     * fw24.addGlobalResourceAccess({
     *   tables: ['users-table'],
     *   buckets: ['assets-bucket']
     * });
     *
     * @param resourceAccess The resource access to add
     */
    addGlobalResourceAccess(resourceAccess) {
        this.logger.debug("addGlobalResourceAccess:", resourceAccess);
        if (resourceAccess.tables) {
            this.globalResourceAccess.tables = [
                ...(this.globalResourceAccess.tables || []),
                ...resourceAccess.tables
            ];
        }
        if (resourceAccess.buckets) {
            this.globalResourceAccess.buckets = [
                ...(this.globalResourceAccess.buckets || []),
                ...resourceAccess.buckets
            ];
        }
        if (resourceAccess.queues) {
            this.globalResourceAccess.queues = [
                ...(this.globalResourceAccess.queues || []),
                ...resourceAccess.queues
            ];
        }
        if (resourceAccess.topics) {
            this.globalResourceAccess.topics = [
                ...(this.globalResourceAccess.topics || []),
                ...resourceAccess.topics
            ];
        }
    }
    /**
     * Get global resource access configuration.
     * @returns The global resource access configuration
     */
    getGlobalResourceAccess() {
        return this.globalResourceAccess;
    }
    setPolicy(policyName, value, prefix = '') {
        this.logger.debug("setPolicy:", prefix, policyName, value);
        const policyKey = (0, keys_1.ensureValidEnvKey)(policyName, prefix);
        if (this.policyStatements.has(policyKey)) {
            this.logger.warn(`Policy ${policyName} already exists in fw24 scope. Overwriting with new policy.`);
        }
        this.policyStatements.set(policyKey, value);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZncyNC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb3JlL2Z3MjQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBQWlFO0FBSWpFLGlEQUFvRztBQUNwRyx5REFBa0U7QUFFbEUsaURBQTRDO0FBQzVDLGlEQUFvRDtBQUNwRCxpREFBc0Q7QUFDdEQsOEJBQW9DO0FBR3BDLHVEQUFvRTtBQUVwRSx3Q0FBMEM7QUFDMUMsd0NBQXdFO0FBQ3hFLHFDQUFrQztBQUlsQyxNQUFhLElBQUk7SUFDSixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUUxQyxPQUFPLEdBQVcsTUFBTSxDQUFDO0lBQ3pCLGFBQWEsQ0FBTTtJQUVYLE1BQU0sR0FBdUIsRUFBRSxDQUFDO0lBQ2hDLEdBQUcsQ0FBTztJQUNWLE1BQU0sR0FBMEIsRUFBRSxDQUFDO0lBQ25DLElBQUksR0FBZ0UsRUFBRSxDQUFDO0lBQ3ZFLG9CQUFvQixHQUF3QixFQUFFLENBQUM7SUFDdEMsMEJBQTBCLEdBQWEsRUFBRSxDQUFDO0lBQzFDLGNBQWMsR0FBbUQsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUNwRixvQkFBb0IsR0FBNEIsRUFBRSxDQUFDO0lBQzFDLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFrRCxDQUFDO0lBQ3RGLGlCQUFpQixDQUEwQjtJQUMzQyxrQkFBa0IsR0FBcUMsRUFBRSxDQUFDO0lBQzFELGFBQWEsQ0FBMEI7SUFDdkMsWUFBWSxHQUFpQyxFQUFFLENBQUM7SUFDaEQsTUFBTSxDQUFDLFFBQVEsQ0FBTztJQUViLE1BQU0sR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztJQUNuQyxNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQWtCLENBQUM7SUFDbkMsT0FBTyxHQUFHLElBQUksR0FBRyxFQUF1QixDQUFDO0lBQ3pDLFVBQVUsR0FBRyxJQUFJLEdBQUcsRUFBeUIsQ0FBQztJQUU5QyxzQkFB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aUIsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDNUMsQ0FBQztJQUNNLG9CQUFvQjtRQUN2QixPQUFPLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDO0lBQzNDLENBQUM7SUFDTSxvQkFBb0I7UUFDdkIsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO0lBQ3ZELENBQUM7SUFFTSxLQUFLLENBQUMsc0JBQXNCLENBQUMsSUFBWSxFQUFFLE1BQThCO1FBQzVFLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztJQUMzQyxDQUFDO0lBQ00saUJBQWlCLENBQUMsSUFBWTtRQUNqQyxPQUFPLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzFDLENBQUM7SUFDTSxpQkFBaUIsQ0FBQyxJQUFZO1FBQ2pDLE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDMUMsQ0FBQztJQUNNLGtCQUFrQjtRQUNyQixPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO0lBQ3JELENBQUM7SUFDTSxrQkFBa0I7UUFDckIsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUM7SUFDekMsQ0FBQztDQUNKO0FBOXRCRCxvQkE4dEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQXBwLCBDZm5PdXRwdXQsIE5lc3RlZFN0YWNrLCBTdGFjayB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IElBdXRob3JpemVyIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXl2Mic7XG5pbXBvcnQgeyBUYWJsZVYyIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCB7IFZwYyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0IHsgRWZmZWN0LCBQb2xpY3lTdGF0ZW1lbnQsIHR5cGUgUG9saWN5U3RhdGVtZW50UHJvcHMsIHR5cGUgUm9sZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0IHsgSG9zdGVkWm9uZSwgSUhvc3RlZFpvbmUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtcm91dGU1Myc7XG5pbXBvcnQgdHlwZSB7IElUb3BpYyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0IHsgVG9waWMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJztcbmltcG9ydCB7IElRdWV1ZSwgUXVldWUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJztcbmltcG9ydCB7IFN0cmluZ1BhcmFtZXRlciB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zc20nO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi9kaSc7XG5pbXBvcnQgeyB0eXBlIElMYW1iZGFFbnZDb25maWcgfSBmcm9tICcuLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IElBcHBsaWNhdGlvbkNvbmZpZywgU3lzdGVtQ29udHJvbGxlckRlZmluaXRpb24sIFN5c3RlbVVJUGFnZURlZmluaXRpb24gfSBmcm9tICcuLi9pbnRlcmZhY2VzL2NvbmZpZyc7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0LCBPdXRwdXRUeXBlIH0gZnJvbSAnLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QnO1xuaW1wb3J0IHsgdHlwZSBJRElDb250YWluZXIgfSBmcm9tICcuLi9pbnRlcmZhY2VzL2RpJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgZW5zdXJlTm9TcGVjaWFsQ2hhcnMsIGVuc3VyZVZhbGlkRW52S2V5IH0gZnJvbSAnLi4vdXRpbHMva2V5cyc7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tICcuL2hlbHBlcic7XG5pbXBvcnQgeyB0eXBlIElGdzI0TW9kdWxlIH0gZnJvbSAnLi9ydW50aW1lL21vZHVsZSc7XG5pbXBvcnQgdHlwZSB7IFRJbXBvcnRlZFBvbGljeSwgVFBvbGljeVN0YXRlbWVudE9yUHJvcHMsIElGdW5jdGlvblJlc291cmNlQWNjZXNzIH0gZnJvbSAnLi4vY29uc3RydWN0cy9sYW1iZGEtZnVuY3Rpb24nO1xuXG5leHBvcnQgY2xhc3MgRncyNCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEZ3MjQubmFtZSk7XG5cbiAgICBhcHBOYW1lOiBzdHJpbmcgPSBcImZ3MjRcIjtcbiAgICBlbWFpbFByb3ZpZGVyOiBhbnk7XG5cbiAgICBwcml2YXRlIGNvbmZpZzogSUFwcGxpY2F0aW9uQ29uZmlnID0ge307XG4gICAgcHJpdmF0ZSBhcHAhOiBBcHA7XG4gICAgcHJpdmF0ZSBzdGFja3M6IFJlY29yZDxzdHJpbmcsIFN0YWNrPiA9IHt9O1xuICAgIHByaXZhdGUgYXBpczogeyBbIGFwaUNvbnN0cnVjdE5hbWU6IHN0cmluZyBdOiB7IFsgbmFtZTogc3RyaW5nIF06IGFueSB9IH0gPSB7fTtcbiAgICBwcml2YXRlIGVudmlyb25tZW50VmFyaWFibGVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgcHJpdmF0ZSByZWFkb25seSBnbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlczogc3RyaW5nW10gPSBbXTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGdsb2JhbFBvbGljaWVzOiBTZXQ8VFBvbGljeVN0YXRlbWVudE9yUHJvcHMgfCBUSW1wb3J0ZWRQb2xpY3k+ID0gbmV3IFNldCgpO1xuICAgIHByaXZhdGUgZ2xvYmFsUmVzb3VyY2VBY2Nlc3M6IElGdW5jdGlvblJlc291cmNlQWNjZXNzID0ge307XG4gICAgcHJpdmF0ZSByZWFkb25seSBwb2xpY3lTdGF0ZW1lbnRzID0gbmV3IE1hcDxzdHJpbmcsIFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50PigpO1xuICAgIHByaXZhdGUgZGVmYXVsdEF1dGhvcml6ZXI6IElBdXRob3JpemVyIHwgdW5kZWZpbmVkO1xuICAgIHByaXZhdGUgY29nbml0b0F1dGhvcml6ZXJzOiB7IFsga2V5OiBzdHJpbmcgXTogSUF1dGhvcml6ZXIgfSA9IHt9O1xuICAgIHByaXZhdGUgand0QXV0aG9yaXplcjogSUF1dGhvcml6ZXIgfCB1bmRlZmluZWQ7XG4gICAgcHJpdmF0ZSBkeW5hbW9UYWJsZXM6IHsgWyBrZXk6IHN0cmluZyBdOiBUYWJsZVYyIH0gPSB7fTtcbiAgICBwcml2YXRlIHN0YXRpYyBpbnN0YW5jZTogRncyNDtcblxuICAgIHByaXZhdGUgcmVhZG9ubHkgcXVldWVzID0gbmV3IE1hcDxzdHJpbmcsIElRdWV1ZT4oKTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHRvcGljcyA9IG5ldyBNYXA8c3RyaW5nLCBJVG9waWM+KCk7XG4gICAgcHJpdmF0ZSByZWFkb25seSBtb2R1bGVzID0gbmV3IE1hcDxzdHJpbmcsIElGdzI0TW9kdWxlPigpO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY29uc3RydWN0cyA9IG5ldyBNYXA8c3RyaW5nLCBGVzI0Q29uc3RydWN0PigpO1xuXG4gICAgcHJpdmF0ZSByZWFkb25seSBnbG9iYWxMYW1iZGFMYXllck5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgcHJpdmF0ZSByZWFkb25seSBnbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2VzID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTsgLy8gcGFja2FnZSAtPiBwcmlvcml0eVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBzeXN0ZW1VSUNvbmZpZ3M6IE1hcDxzdHJpbmcsIFN5c3RlbVVJUGFnZURlZmluaXRpb24+ID0gbmV3IE1hcCgpO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgc3lzdGVtQ29udHJvbGxlcnM6IE1hcDxzdHJpbmcsIFN5c3RlbUNvbnRyb2xsZXJEZWZpbml0aW9uPiA9IG5ldyBNYXAoKTtcblxuICAgIHByaXZhdGUgY29uc3RydWN0b3IoKSB7IH0gLy8gRW1wdHkgY29uc3RydWN0b3IgYXMgQXBwIGlzIHNldCB2aWEgc2V0QXBwKClcblxuICAgIHN0YXRpYyBnZXRJbnN0YW5jZSgpOiBGdzI0IHtcbiAgICAgICAgaWYgKCFGdzI0Lmluc3RhbmNlKSB7XG4gICAgICAgICAgICBGdzI0Lmluc3RhbmNlID0gbmV3IEZ3MjQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBGdzI0Lmluc3RhbmNlO1xuICAgIH1cblxuICAgIHNldEFwcChhcHA6IEFwcCkge1xuICAgICAgICB0aGlzLmFwcCA9IGFwcDtcbiAgICB9XG5cbiAgICBnZXRBcHAoKTogQXBwIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuYXBwO1xuICAgIH1cblxuICAgIHNldENvbmZpZyhjb25maWc6IElBcHBsaWNhdGlvbkNvbmZpZykge1xuICAgICAgICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgICAgICAgLy8gSHlkcmF0ZSB0aGUgY29uZmlnIG9iamVjdCB3aXRoIGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyh0aGlzLmNvbmZpZyk7XG4gICAgICAgIC8vIFNldCB0aGUgYXBwIG5hbWVcbiAgICAgICAgdGhpcy5hcHBOYW1lID0gY29uZmlnLm5hbWUhO1xuICAgIH1cblxuICAgIGdldENvbmZpZygpOiBJQXBwbGljYXRpb25Db25maWcge1xuICAgICAgICByZXR1cm4gdGhpcy5jb25maWc7XG4gICAgfVxuXG4gICAgZ2V0QXBwRElDb250YWluZXIoKTogSURJQ29udGFpbmVyIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmFwcERJQ29udGFpbmVyIHx8IERJQ29udGFpbmVyLlJPT1Q7XG4gICAgfVxuXG4gICAgZ2V0TGFtYmRhRW50cnlQYWNrYWdlcygpOiBzdHJpbmdbXSB7XG4gICAgICAgIGlmICh0aGlzLmNvbmZpZy5sYW1iZGFFbnRyeVBhY2thZ2VzKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jb25maWcubGFtYmRhRW50cnlQYWNrYWdlcztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNvcnQgZW50cnkgcGFja2FnZXMgYnkgcHJpb3JpdHkgKGxvd2VyIG51bWJlciA9IGxvYWRlZCBmaXJzdClcbiAgICAgICAgcmV0dXJuIEFycmF5LmZyb20odGhpcy5nbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2VzLmVudHJpZXMoKSlcbiAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBhWyAxIF0gLSBiWyAxIF0pICAvLyBTb3J0IGJ5IHByaW9yaXR5XG4gICAgICAgICAgICAubWFwKChbIHBhY2thZ2VOYW1lIF0pID0+IHBhY2thZ2VOYW1lKTtcbiAgICB9XG5cbiAgICBhZGRHbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2UocGFja2FnZU5hbWU6IHN0cmluZywgcHJpb3JpdHk6IG51bWJlciA9IDk5OSkge1xuICAgICAgICB0aGlzLmdsb2JhbExhbWJkYUVudHJ5UGFja2FnZXMuc2V0KHBhY2thZ2VOYW1lLCBwcmlvcml0eSk7XG4gICAgfVxuXG4gICAgaGFzR2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlKHBhY2thZ2VOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlcy5oYXMocGFja2FnZU5hbWUpO1xuICAgIH1cblxuICAgIHJlbW92ZUdsb2JhbExhbWJkYUVudHJ5UGFja2FnZShwYWNrYWdlTmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuZ2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlcy5kZWxldGUocGFja2FnZU5hbWUpO1xuICAgIH1cblxuICAgIGdldEdsb2JhbExhbWJkYUxheWVyTmFtZXMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdsb2JhbExhbWJkYUxheWVyTmFtZXM7XG4gICAgfVxuXG4gICAgYWRkR2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyhsYXllck5hbWU6IHN0cmluZykge1xuICAgICAgICB0aGlzLmdsb2JhbExhbWJkYUxheWVyTmFtZXMuYWRkKGxheWVyTmFtZSk7XG4gICAgfVxuXG4gICAgaGFzR2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyhsYXllck5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5nbG9iYWxMYW1iZGFMYXllck5hbWVzLmhhcyhsYXllck5hbWUpO1xuICAgIH1cblxuICAgIHJlbW92ZUdsb2JhbExhbWJkYUxheWVyTmFtZXMobGF5ZXJOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5nbG9iYWxMYW1iZGFMYXllck5hbWVzLmRlbGV0ZShsYXllck5hbWUpO1xuICAgIH1cblxuICAgIGFkZFN0YWNrKG5hbWU6IHN0cmluZywgc3RhY2s6IGFueSk6IHRoaXMge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImFkZFN0YWNrOlwiLCB7IG5hbWUgfSk7XG4gICAgICAgIHRoaXMuc3RhY2tzWyBuYW1lIF0gPSBzdGFjaztcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSBzdGFjayBieSBuYW1lLiBJZiB0aGUgc3RhY2sgZG9lcyBub3QgZXhpc3QsIGNyZWF0ZSBpdC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gbmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBzdGFjayB0byBnZXQuXG4gICAgICogQHBhcmFtIHBhcmVudFN0YWNrTmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBwYXJlbnQgc3RhY2suXG4gICAgICogQHJldHVybnMgVGhlIHN0YWNrLlxuICAgICAqL1xuICAgIGdldFN0YWNrKG5hbWU/OiBzdHJpbmcsIHBhcmVudFN0YWNrTmFtZT86IHN0cmluZyk6IGFueSB7XG4gICAgICAgIGxldCBzdGFja05hbWU6IHN0cmluZyA9IG5hbWUgfHwgdGhpcy5nZXREZWZhdWx0U3RhY2tOYW1lKCk7XG4gICAgICAgIC8vIGRvbid0IGFsbG93IG5lc3RlZCBzdGFja3MgaWYgbXVsdGlTdGFjayBpcyB0cnVlLCBtdWx0aXN0YWNrIGlzIHVzZWQgZm9yIGNyZWF0aW5nIGluZGVwZW5kZW50IHN0YWNrc1xuICAgICAgICBpZiAodGhpcy5jb25maWcubXVsdGlTdGFjayAmJiBwYXJlbnRTdGFja05hbWUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTmVzdGVkIHN0YWNrcyBhcmUgbm90IGFsbG93ZWQgd2hlbiBtdWx0aVN0YWNrIGlzIHRydWUuIFBsZWFzZSB1c2UgbXVsdGlTdGFjazogZmFsc2Ugb3IgcmVtb3ZlIHRoZSBwYXJlbnRTdGFja05hbWUgcGFyYW1ldGVyLicpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGlmIHRoZSBzdGFjayBkb2VzIG5vdCBleGlzdCBhbmQgbXVsdGlTdGFjayBpcyBmYWxzZSBhbmQgcGFyZW50U3RhY2tOYW1lIGlzIG5vdCBwcm92aWRlZCwgdGhlbiB1c2UgdGhlIGRlZmF1bHQgc3RhY2sgbmFtZVxuICAgICAgICBpZiAodGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdID09PSB1bmRlZmluZWQgJiYgISh0aGlzLmNvbmZpZy5tdWx0aVN0YWNrIHx8IHBhcmVudFN0YWNrTmFtZSkpIHtcbiAgICAgICAgICAgIHN0YWNrTmFtZSA9IHRoaXMuZ2V0RGVmYXVsdFN0YWNrTmFtZSgpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiR2V0dGluZyBTdGFjayBXaXRoIE5hbWU6XCIsIHsgc3RhY2tOYW1lIH0pO1xuICAgICAgICBpZiAodGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGlmIChwYXJlbnRTdGFja05hbWUpIHtcbiAgICAgICAgICAgICAgICAvLyBjcmVhdGUgYSBuZXcgbmVzdGVkIHN0YWNrXG4gICAgICAgICAgICAgICAgdGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdID0gbmV3IE5lc3RlZFN0YWNrKHRoaXMuZ2V0U3RhY2socGFyZW50U3RhY2tOYW1lKSwgc3RhY2tOYW1lKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNyZWF0ZWQgbmVzdGVkIHN0YWNrOlwiLCB7IHN0YWNrTmFtZSwgcGFyZW50U3RhY2tOYW1lIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsZXQgc3RhY2tJRCA9IGAke3RoaXMuYXBwTmFtZX0tJHtzdGFja05hbWV9LXN0YWNrYDtcbiAgICAgICAgICAgICAgICAvLyBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eSBmb3Igb2xkIHN0YWNrIG5hbWVzXG4gICAgICAgICAgICAgICAgaWYgKHN0YWNrTmFtZSA9PT0gJ3ByZW11bHRpc3RhY2snKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0YWNrSUQgPSBgJHt0aGlzLmFwcE5hbWV9LXN0YWNrYDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gY3JlYXRlIGEgbmV3IHN0YWNrXG4gICAgICAgICAgICAgICAgdGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdID0gbmV3IFN0YWNrKHRoaXMuYXBwLCBzdGFja0lELCB7XG4gICAgICAgICAgICAgICAgICAgIGVudjoge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWNjb3VudDogdGhpcy5jb25maWcuYWNjb3VudCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lvbjogdGhpcy5jb25maWcucmVnaW9uXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAvLyBtYWtlIGFsbCBzdGFja3MgZGVwZW5kZW50IG9uIHRoZSBsYXllciBzdGFja1xuICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyU3RhY2sgPSB0aGlzLmdldFN0YWNrKHRoaXMuY29uZmlnLmxheWVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgICAgICBpZiAobGF5ZXJTdGFjaykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YWNrc1sgc3RhY2tOYW1lIF0uYWRkRGVwZW5kZW5jeShsYXllclN0YWNrKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGVkIHN0YWNrOlwiLCB7IHN0YWNrTmFtZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdO1xuICAgIH1cblxuICAgIGdldERlZmF1bHRTdGFja05hbWUoKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRlZmF1bHRTdGFja05hbWUgfHwgJ21haW4nO1xuICAgIH1cblxuICAgIHVzZU11bHRpU3RhY2tTZXR1cCA9IChjdXJyZW50U3RhY2tOYW1lPzogc3RyaW5nLCByZXNvdXJjZVN0YWNrPzogU3RhY2spOiBib29sZWFuID0+IHtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgIHRoaXMuZ2V0Q29uZmlnKCkubXVsdGlTdGFja1xuICAgICAgICAgICAgJiYgdGhpcy5nZXRDb25maWcoKS5tdWx0aVN0YWNrID09PSB0cnVlXG4gICAgICAgICAgICAmJiAoXG4gICAgICAgICAgICAgICAgLy8gaWYgcmVzb3VyY2Ugc3RhY2sgaXMgbm90IHByb3ZpZGVkLCB0aGVuIG9ubHkgY2hlY2sgaWYgbXVsdGktc3RhY2sgaXMgZW5hYmxlZFxuICAgICAgICAgICAgICAgICFyZXNvdXJjZVN0YWNrIHx8XG4gICAgICAgICAgICAgICAgLy8gaWYgcmVzb3VyY2Ugc3RhY2sgaXMgcHJvdmlkZWQsIHRoZW4gY2hlY2sgaWYgaXQgaXMgYSBkaWZmZXJlbnQgc3RhY2sgdGhhbiB0aGUgY3VycmVudCBzdGFja1xuICAgICAgICAgICAgICAgICEocmVzb3VyY2VTdGFjaz8uc3RhY2tOYW1lLmVuZHNXaXRoKGN1cnJlbnRTdGFja05hbWUgKyAnLXN0YWNrJykgfHwgcmVzb3VyY2VTdGFjaz8uc3RhY2tOYW1lID09PSBjdXJyZW50U3RhY2tOYW1lKVxuICAgICAgICAgICAgKVxuICAgICAgICApIHx8IGZhbHNlO1xuICAgIH1cblxuICAgIGFkZEFQSShhcGlDb25zdHJ1Y3ROYW1lOiBzdHJpbmcsIG5hbWU6IHN0cmluZywgYXBpOiBhbnksIGlzSW1wb3J0ZWQ6IGJvb2xlYW4gPSBmYWxzZSk6IHRoaXMge1xuICAgICAgICAvLyBJbml0aWFsaXplIHRoZSBhcGlDb25zdHJ1Y3ROYW1lIG9iamVjdCBpZiBpdCBkb2Vzbid0IGV4aXN0XG4gICAgICAgIGlmICghdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF0pIHtcbiAgICAgICAgICAgIHRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdID0ge307XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhZGRBUEk6XCIsIHsgbmFtZSB9KTtcbiAgICAgICAgdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF1bIG5hbWUgXSA9IHsgYXBpOiBhcGksIGlzSW1wb3J0ZWQ6IGlzSW1wb3J0ZWQgfTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZ2V0QVBJKGFwaUNvbnN0cnVjdE5hbWU6IHN0cmluZywgbmFtZTogc3RyaW5nKTogYW55IHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgQVBJIGV4aXN0cyBmb3IgdGhlIGdpdmVuIG5hbWUgYW5kIHN0YWNrXG4gICAgICAgIGlmICghdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF0/LlsgbmFtZSBdKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQVBJIG5vdCBmb3VuZDogY29uc3RydWN0IG5hbWUgJHthcGlDb25zdHJ1Y3ROYW1lfSBhbmQgbmFtZSAke25hbWV9YCk7XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmFwaXNbIGFwaUNvbnN0cnVjdE5hbWUgXVsgbmFtZSBdO1xuICAgIH1cblxuICAgIGdldEFQSXMoYXBpQ29uc3RydWN0TmFtZTogc3RyaW5nKTogYW55IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdO1xuICAgIH1cblxuICAgIGhhc0ltcG9ydGVkQVBJKGFwaUNvbnN0cnVjdE5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgICAgICBpZiAoIXRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiBhbnkgQVBJIGluIGFueSBzdGFjayBpcyBtYXJrZWQgYXMgaW1wb3J0ZWRcbiAgICAgICAgcmV0dXJuIE9iamVjdC52YWx1ZXModGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF0pXG4gICAgICAgICAgICAuc29tZShhcGkgPT4gYXBpLmlzSW1wb3J0ZWQgPT09IHRydWUpO1xuICAgIH1cblxuICAgIGFkZE1vZHVsZShuYW1lOiBzdHJpbmcsIG1vZHVsZTogSUZ3MjRNb2R1bGUpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhZGRNb2R1bGU6XCIsIHsgbmFtZSwgbW9kdWxlOiBtb2R1bGUuZ2V0QmFzZVBhdGgoKSB9KTtcblxuICAgICAgICAvLyBjb2xsZWN0IGFsbCBleHBvcnRlZCBwb2xpY2llcyBmcm9tIHRoaXMgbW9kdWxlXG4gICAgICAgIGZvciAoY29uc3QgWyBwb2xpY3lOYW1lLCBwb2xpY3kgXSBvZiBtb2R1bGUuZ2V0RXhwb3J0ZWRQb2xpY2llcygpKSB7XG4gICAgICAgICAgICB0aGlzLnNldFBvbGljeShwb2xpY3lOYW1lLCBwb2xpY3ksIG1vZHVsZS5nZXROYW1lKCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gYWRkIGFsbCBleHBvcnRlZCBzdGF0aWMgZW52IHZhbHVlcyBpbnRvIHRoZSBGVzI0IHNjb3BlXG4gICAgICAgIGZvciAoY29uc3QgWyBlbnZOYW1lLCBlbnZWYWx1ZSBdIG9mIG1vZHVsZS5nZXRFeHBvcnRlZEVudmlyb25tZW50VmFyaWFibGVzKCkpIHtcbiAgICAgICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShlbnZOYW1lLCBlbnZWYWx1ZSwgbW9kdWxlLmdldE5hbWUoKSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLm1vZHVsZXMuc2V0KG5hbWUsIG1vZHVsZSk7XG4gICAgfVxuXG4gICAgZ2V0TW9kdWxlcygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubW9kdWxlc1xuICAgIH1cblxuICAgIGhhc01vZHVsZXMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm1vZHVsZXMuc2l6ZSA+IDA7XG4gICAgfVxuXG4gICAgZ2V0VW5pcXVlTmFtZShuYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIGAke25hbWV9LSR7dGhpcy5jb25maWcubmFtZX0tJHt0aGlzLmNvbmZpZy5lbnZpcm9ubWVudCB8fCAnZW52J30tJHt0aGlzLmNvbmZpZy5hY2NvdW50fWA7XG4gICAgfVxuXG4gICAgZ2V0QXJuKHR5cGU6IHN0cmluZywgbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIGBhcm46YXdzOiR7dHlwZX06JHt0aGlzLmNvbmZpZy5yZWdpb259OiR7dGhpcy5jb25maWcuYWNjb3VudH06JHtuYW1lfWA7XG4gICAgfVxuXG4gICAgc2V0Q29nbml0b0F1dGhvcml6ZXIobmFtZTogc3RyaW5nLCBhdXRob3JpemVyOiBJQXV0aG9yaXplciwgZGVmYXVsdEF1dGhvcml6ZXI6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcInNldENvZ25pdG9BdXRob3JpemVyOiBcIiwgeyBuYW1lLCBhdXRob3JpemVyOiBhdXRob3JpemVyLmF1dGhvcml6ZXJJZCwgZGVmYXVsdEF1dGhvcml6ZXIgfSk7XG5cbiAgICAgICAgdGhpcy5jb2duaXRvQXV0aG9yaXplcnNbIG5hbWUgXSA9IGF1dGhvcml6ZXI7XG4gICAgICAgIC8vIElmIHRoaXMgYXV0aG9yaXplciBpcyB0aGUgZGVmYXVsdCwgc2V0IGl0IGFzIHRoZSBkZWZhdWx0IGF1dGhvcml6ZXJcbiAgICAgICAgaWYgKGRlZmF1bHRBdXRob3JpemVyICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgdGhpcy5kZWZhdWx0QXV0aG9yaXplciA9IGF1dGhvcml6ZXI7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRDb2duaXRvQXV0aG9yaXplcihuYW1lPzogc3RyaW5nKTogSUF1dGhvcml6ZXIgfCB1bmRlZmluZWQge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImdldENvZ25pdG9BdXRob3JpemVyOiBcIiwgeyBuYW1lIH0pO1xuICAgICAgICAvLyBJZiBubyBuYW1lIGlzIHByb3ZpZGVkIGFuZCBubyBkZWZhdWx0IGF1dGhvcml6ZXIgaXMgc2V0LCB0aHJvdyBhbiBlcnJvclxuICAgICAgICBpZiAobmFtZSA9PT0gdW5kZWZpbmVkICYmIHRoaXMuZGVmYXVsdEF1dGhvcml6ZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBBdXRob3JpemVyIGV4aXN0cyBmb3IgY29nbml0byB1c2VyIHBvb2xzLiBGb3IgcG9saWN5IGJhc2VkIGF1dGhlbnRpY2F0aW9uLCB1c2UgQVdTX0lBTSBhdXRob3Jpc2VyLicpO1xuICAgICAgICB9XG4gICAgICAgIC8vIElmIG5vIG5hbWUgaXMgcHJvdmlkZWQsIHJldHVybiB0aGUgZGVmYXVsdCBhdXRob3JpemVyXG4gICAgICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmRlZmF1bHRBdXRob3JpemVyO1xuICAgICAgICB9XG4gICAgICAgIC8vIGlmIGF1dGhvcml6ZXIgd2l0aCBuYW1lIGlzIG5vdCBmb3VuZCwgdGhyb3cgYW4gZXJyb3JcbiAgICAgICAgaWYgKHRoaXMuY29nbml0b0F1dGhvcml6ZXJzWyBuYW1lIF0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdXRob3JpemVyIHdpdGggbmFtZTogJHtuYW1lfSBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBJZiBhIG5hbWUgaXMgcHJvdmlkZWQsIHJldHVybiB0aGUgYXV0aG9yaXplciB3aXRoIHRoYXQgbmFtZVxuICAgICAgICByZXR1cm4gdGhpcy5jb2duaXRvQXV0aG9yaXplcnNbIG5hbWUgXTtcbiAgICB9XG5cbiAgICBnZXRBdXRob3JpemVyKGF1dGhvcml6YXRpb25UeXBlOiBzdHJpbmcsIG5hbWU/OiBzdHJpbmcpOiBJQXV0aG9yaXplciB8IHVuZGVmaW5lZCB7XG4gICAgICAgIGlmIChhdXRob3JpemF0aW9uVHlwZSA9PT0gXCJDT0dOSVRPX1VTRVJfUE9PTFNcIikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0Q29nbml0b0F1dGhvcml6ZXIobmFtZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGF1dGhvcml6YXRpb25UeXBlID09PSBcIkpXVFwiKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRKd3RBdXRob3JpemVyKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBzZXREZWZhdWx0Q29nbml0b0F1dGhvcml6ZXJOYW1lKG5hbWU6IHN0cmluZykge1xuICAgICAgICB0aGlzLnNldEVudmlyb25tZW50VmFyaWFibGUoJ2RlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUnLCBuYW1lLCAnY29nbml0bycpO1xuICAgIH1cblxuICAgIGdldERlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUoJ2RlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUnLCAnY29nbml0bycpO1xuICAgIH1cblxuICAgIHNldEVudmlyb25tZW50VmFyaWFibGUobmFtZTogc3RyaW5nLCB2YWx1ZTogYW55LCBwcmVmaXg6IHN0cmluZyA9ICcnKSB7XG4gICAgICAgIHRoaXMuZW52aXJvbm1lbnRWYXJpYWJsZXNbIGVuc3VyZVZhbGlkRW52S2V5KG5hbWUsIHByZWZpeCkgXSA9IHZhbHVlO1xuICAgIH1cblxuICAgIGdldEVudmlyb25tZW50VmFyaWFibGUobmFtZTogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyA9ICcnLCBzY29wZT86IGFueSk6IGFueSB7XG4gICAgICAgIC8vIGlmIGxvb2t1cCBpcyBmb3IgY29uc3RydWN0IG91dHB1dCAoYmFzZWQgb24gcHJlZml4IGJlaW5nIG9uZSBvZiB0aGUgb3V0cHV0IHR5cGVzKVxuICAgICAgICAvLyBhbmQgdGhlIGFwcGxpY2F0aW9uIGhhcyBtdWx0aXBsZSBzdGFja3MsIHRoZW4gbG9vayBmb3IgdmFsdWUgaW4gdGhlIHN0YWNrIGV4cG9ydFxuICAgICAgICAvLyBpZiB0aGUgc2NvcGUgaXMgZGVmaW5lZCBhbmQgaXMgYSBzdGFjayBhbmQgdGhlIG91dHB1dCBpcyBmcm9tIHRoZSBzYW1lIHN0YWNrLCB0aGVuIHJldHVybiB0aGUgdmFsdWVcblxuICAgICAgICBpZiAocHJlZml4Lmxlbmd0aCA+IDAgJiYgc2NvcGUgJiYgc2NvcGUgaW5zdGFuY2VvZiBTdGFjayAmJiB0aGlzLnVzZU11bHRpU3RhY2tTZXR1cCgpKSB7XG4gICAgICAgICAgICBjb25zdCBpc1ByZWZpeE91dHB1dFR5cGUgPSBPYmplY3QudmFsdWVzKE91dHB1dFR5cGUpLmluY2x1ZGVzKHByZWZpeC5zcGxpdCgnXycpWyAwIF0gYXMgT3V0cHV0VHlwZSk7XG4gICAgICAgICAgICBpZiAoaXNQcmVmaXhPdXRwdXRUeXBlKSB7XG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIFNTTSBwYXJhbWV0ZXIgcmVmZXJlbmNlXG4gICAgICAgICAgICAgICAgLy8gbWFrZSBzdXJlIHRoZSBrZXkgaXMgc3BlY2lmaWVkIGFzIHF1YWxpZmllZCBrZXkgaS5lLiBrZXlfZXhwb3J0VmFsdWVLZXlcbiAgICAgICAgICAgICAgICAvLyBpdCBpcyBwb3NzaWJsZSB0aGF0IHRoZSBrZXkgaXMgbm90IHF1YWxpZmllZCBpZiB0aGUgcHJlZml4IGhhcyBvdXRwdXQgdHlwZSBhbmQga2V5IG5hbWUuIGllLiBwcmVmaXg6IHVzZXJwb29sX2F1dGhtb2R1bGUsIGtleTogdXNlclBvb2xJZFxuICAgICAgICAgICAgICAgIGlmICghbmFtZS5pbmNsdWRlcygnXycpICYmICFwcmVmaXguaW5jbHVkZXMoJ18nKSkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEVudmlyb25tZW50IHZhcmlhYmxlICR7bmFtZX0gaXMgbm90IGEgcXVhbGlmaWVkIGtleS4gUGxlYXNlIHNwZWNpZnkgYXMga2V5X2V4cG9ydFZhbHVlS2V5LiBlLmcuIHJlc3RBUElfcmVzdEFwaUlkYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvbnN0IHNzbUtleSA9IHRoaXMuZW52aXJvbm1lbnRWYXJpYWJsZXNbIGVuc3VyZVZhbGlkRW52S2V5KG5hbWUsIGBTU006JHtwcmVmaXh9YCkgXTtcblxuICAgICAgICAgICAgICAgIGlmIChzc21LZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhY2tOYW1lID0gc3NtS2V5LnNwbGl0KCcvJylbIDEgXTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENoZWNraW5nIGlmIG11bHRpLXN0YWNrIHNldHVwIHNob3VsZCBiZSB1c2VkIGZvciBlbnZpcm9ubWVudCB2YXJpYWJsZTogJHtlbnN1cmVWYWxpZEVudktleShuYW1lLCBwcmVmaXgpfSBpbiBzdGFjazogJHtzdGFja05hbWV9IGNhbGxlZCBmcm9tIHN0YWNrOiAke3Njb3BlLnN0YWNrTmFtZX0gLSAke3RoaXMudXNlTXVsdGlTdGFja1NldHVwKHN0YWNrTmFtZSwgc2NvcGUpfWApO1xuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy51c2VNdWx0aVN0YWNrU2V0dXAoc3RhY2tOYW1lLCBzY29wZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEFkZCBjcm9zcy1zdGFjayBkZXBlbmRlbmN5XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzb3VyY2VTdGFjayA9IHRoaXMuc3RhY2tzWyBzdGFja05hbWUgXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzb3VyY2VTdGFjaykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjb3BlLmFkZERlcGVuZGVuY3koc291cmNlU3RhY2spO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRlZCBkZXBlbmRlbmN5IGZyb20gJHtzY29wZS5zdGFja05hbWV9IHRvICR7c3RhY2tOYW1lfSBmb3IgU1NNIGtleTogJHtzc21LZXl9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBdHRlbXB0aW5nIHRvIGltcG9ydCBTU00gdmFsdWUgZm9yIGtleTogJHtzc21LZXl9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFN0cmluZ1BhcmFtZXRlci52YWx1ZUZvclN0cmluZ1BhcmFtZXRlcihzY29wZSwgc3NtS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gU1NNIGtleSBmb3VuZCBpbiBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIGtleTogJHtlbnN1cmVWYWxpZEVudktleShuYW1lLCBgU1NNOiR7cHJlZml4fWApfSwgdXNpbmcgZGlyZWN0IHJlZmVyZW5jZWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmVudmlyb25tZW50VmFyaWFibGVzWyBlbnN1cmVWYWxpZEVudktleShuYW1lLCBwcmVmaXgpIF07XG4gICAgfVxuXG4gICAgaGFzRW52aXJvbm1lbnRWYXJpYWJsZShuYW1lOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nID0gJycpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIChlbnN1cmVWYWxpZEVudktleShuYW1lLCBwcmVmaXgpIGluIHRoaXMuZW52aXJvbm1lbnRWYXJpYWJsZXMpO1xuICAgIH1cblxuICAgIHJlc29sdmVFbnZWYXJpYWJsZXMgPSAoZW52OiBJTGFtYmRhRW52Q29uZmlnW10gPSBbXSwgc2NvcGU/OiBhbnkpID0+IHtcbiAgICAgICAgY29uc3QgcmVzb2x2ZWQ6IGFueSA9IHt9O1xuICAgICAgICBmb3IgKGNvbnN0IGVudkNvbmZpZyBvZiBlbnYpIHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gZW52Q29uZmlnLnZhbHVlID8/IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShlbnZDb25maWcubmFtZSwgZW52Q29uZmlnLnByZWZpeCwgc2NvcGUpO1xuICAgICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZWRbIGVudkNvbmZpZy5leHBvcnROYW1lID8/IGVudkNvbmZpZy5uYW1lIF0gPSB2YWx1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgRW52aXJvbm1lbnQgdmFyaWFibGUgW3ByZWZpeDogJHtlbnZDb25maWcucHJlZml4fV0gJHtlbnZDb25maWcubmFtZX0gbm90IGZvdW5kIGluIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc29sdmVkO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIHZhbHVlIGZvciB0aGUgZ2l2ZW4gdGVtcGxhdGUgZnJvbSB0aGUgRncyNC1zY29wZSBlbnYgaWYgaXQgZm9sbG93cyB0aGUgY29udmVudGlvbnMgbGlrZSBgZW52Onh4eDp5eXlgLCBgZW52Onl5eWAuXG4gICAgICogXG4gICAgICogQHBhcmFtIGtleVRlbXBsYXRlIC0gVGhlIHRlbXBsYXRlIGZvciB0aGUgZW52aXJvbm1lbnQga2V5IHRvIHJlc29sdmUuXG4gICAgICogIGUuZy4gZW52OlVzZXJzX1RhYmxlX25hbWUsIGVudjp1c2VyTW9kdWxlOlVzZXJzX1RhYmxlX25hbWVcbiAgICAgKiBAcmV0dXJucyBUaGUgcmVzb2x2ZWQgdmFsdWUgZm9yIHRoZSBrZXkuXG4gICAgICovXG4gICAgdHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlID0gKGtleVRlbXBsYXRlOiBzdHJpbmcpID0+IHtcbiAgICAgICAgaWYgKGtleVRlbXBsYXRlLnN0YXJ0c1dpdGgoJ2VudjonKSkge1xuICAgICAgICAgICAgLy8gZW52OnVzZXJNb2R1bGU6VXNlcnNfVGFibGVfbmFtZSA9PiBbJ2VudicsICd1c2VyTW9kdWxlJywgJ1VzZXJzX1RhYmxlX25hbWUnXTtcbiAgICAgICAgICAgIGNvbnN0IHBhcnRzID0ga2V5VGVtcGxhdGUuc3BsaXQoJzonKTtcblxuICAgICAgICAgICAgLy8gZ2V0IHRoZSBhY3R1YWwgdmFsdWUgZnJvbSB0aGUgZncyNCBzY29wZSA9PT4gZncyNC5nZXQoJ1VzZXJzX1RhYmxlX25hbWUnLCAndXNlck1vZHVsZScpO1xuICAgICAgICAgICAga2V5VGVtcGxhdGUgPSBwYXJ0cy5sZW5ndGggPT09IDMgPyB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUocGFydHNbIDIgXSwgcGFydHNbIDEgXSkgOiB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUocGFydHNbIDEgXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGtleVRlbXBsYXRlO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNldCBhIGdsb2JhbCBlbnZpcm9ubWVudCB2YXJpYWJsZS4gVGhpcyB2YXJpYWJsZSB3aWxsIGJlIGF2YWlsYWJsZSB0byBhbGwgbGFtYmRhIGZ1bmN0aW9ucy5cbiAgICAgKiBAcGFyYW0gbmFtZSBUaGUgbmFtZSBvZiB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUuXG4gICAgICogQHBhcmFtIHZhbHVlIFRoZSB2YWx1ZSBvZiB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUuXG4gICAgICovXG4gICAgc2V0R2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZShuYW1lOiBzdHJpbmcsIHZhbHVlOiBhbnkpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJzZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlOlwiLCBuYW1lLCB2YWx1ZSk7XG4gICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShuYW1lLCB2YWx1ZSwgJycpO1xuICAgICAgICB0aGlzLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzLnB1c2goZW5zdXJlVmFsaWRFbnZLZXkobmFtZSwgJycpKTtcbiAgICB9XG5cbiAgICBnZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcygpOiBzdHJpbmdbXSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEFkZCBhIHBvbGljeSBzdGF0ZW1lbnQgdGhhdCBzaG91bGQgYmUgYXR0YWNoZWQgdG8gQUxMIExhbWJkYSBmdW5jdGlvbnMgaW4gdGhlIGFwcGxpY2F0aW9uLlxuICAgICAqIFRoaXMgaXMgdXNlZnVsIGZvciBjcm9zcy1jdXR0aW5nIGNvbmNlcm5zIGxpa2Ugb2JzZXJ2YWJpbGl0eSwgbG9nZ2luZywgb3Igc2hhcmVkIHJlc291cmNlcy5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIC8vIEFkZCBhbiBpbXBvcnRlZCBwb2xpY3kgYnkgbmFtZVxuICAgICAqIGZ3MjQuYWRkR2xvYmFsUG9saWN5KCdteS1wb2xpY3ktbmFtZScpO1xuICAgICAqIGZ3MjQuYWRkR2xvYmFsUG9saWN5KCdteS1wb2xpY3ktbmFtZScsICdteS1wcmVmaXgnKTtcbiAgICAgKiBmdzI0LmFkZEdsb2JhbFBvbGljeSh7IG5hbWU6ICdteS1wb2xpY3ktbmFtZScsIHByZWZpeDogJ215LXByZWZpeCcsIGlzT3B0aW9uYWw6IHRydWUgfSk7XG4gICAgICogXG4gICAgICogLy8gQWRkIGEgZGlyZWN0IHBvbGljeSBzdGF0ZW1lbnRcbiAgICAgKiBmdzI0LmFkZEdsb2JhbFBvbGljeShuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgKiAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAqICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnXSxcbiAgICAgKiAgIHJlc291cmNlczogWycqJ11cbiAgICAgKiB9KSk7XG4gICAgICogXG4gICAgICogLy8gQWRkIHBvbGljeSBzdGF0ZW1lbnQgcHJvcHNcbiAgICAgKiBmdzI0LmFkZEdsb2JhbFBvbGljeSh7XG4gICAgICogICBlZmZlY3Q6IEVmZmVjdC5BTExPVyxcbiAgICAgKiAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0J10sXG4gICAgICogICByZXNvdXJjZXM6IFsnKiddXG4gICAgICogfSk7XG4gICAgICogXG4gICAgICogQHBhcmFtIHBvbGljeSBUaGUgcG9saWN5IHRvIGFkZCAtIGNhbiBiZSBhIG5hbWUgc3RyaW5nLCBUSW1wb3J0ZWRQb2xpY3ksIFBvbGljeVN0YXRlbWVudCwgb3IgUG9saWN5U3RhdGVtZW50UHJvcHNcbiAgICAgKiBAcGFyYW0gcHJlZml4IFRoZSBwcmVmaXggZm9yIGltcG9ydGVkIHBvbGljeSBuYW1lIChvcHRpb25hbCwgb25seSB1c2VkIHdoZW4gcG9saWN5IGlzIGEgc3RyaW5nKVxuICAgICAqIEBwYXJhbSBpc09wdGlvbmFsIFdoZXRoZXIgdGhlIHBvbGljeSBpcyBvcHRpb25hbCAob3B0aW9uYWwsIG9ubHkgdXNlZCB3aGVuIHBvbGljeSBpcyBhIHN0cmluZylcbiAgICAgKi9cbiAgICBhZGRHbG9iYWxQb2xpY3kocG9saWN5OiBzdHJpbmcgfCBUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeSwgcHJlZml4OiBzdHJpbmcgPSAnJywgaXNPcHRpb25hbDogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgICAgIGlmICh0eXBlb2YgcG9saWN5ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgLy8gVHJlYXQgYXMgaW1wb3J0ZWQgcG9saWN5IG5hbWUgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiYWRkR2xvYmFsUG9saWN5IChpbXBvcnRlZCk6XCIsIHsgbmFtZTogcG9saWN5LCBwcmVmaXgsIGlzT3B0aW9uYWwgfSk7XG4gICAgICAgICAgICB0aGlzLmdsb2JhbFBvbGljaWVzLmFkZCh7IG5hbWU6IHBvbGljeSwgcHJlZml4LCBpc09wdGlvbmFsIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRGlyZWN0IHBvbGljeSBzdGF0ZW1lbnQgb3IgUG9saWN5U3RhdGVtZW50UHJvcHMgb3IgVEltcG9ydGVkUG9saWN5XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImFkZEdsb2JhbFBvbGljeSAoZGlyZWN0KTpcIiwgeyBwb2xpY3kgfSk7XG4gICAgICAgICAgICB0aGlzLmdsb2JhbFBvbGljaWVzLmFkZChwb2xpY3kpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGFsbCBnbG9iYWwgcG9saWNpZXMgdGhhdCBzaG91bGQgYmUgYXR0YWNoZWQgdG8gQUxMIExhbWJkYSBmdW5jdGlvbnMuXG4gICAgICogQHJldHVybnMgU2V0IG9mIHBvbGljaWVzIChjYW4gYmUgVFBvbGljeVN0YXRlbWVudE9yUHJvcHMgb3IgVEltcG9ydGVkUG9saWN5KVxuICAgICAqL1xuICAgIGdldEdsb2JhbFBvbGljaWVzKCk6IFNldDxUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5nbG9iYWxQb2xpY2llcztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXQgZ2xvYmFsIHJlc291cmNlIGFjY2VzcyB0aGF0IHNob3VsZCBiZSBhcHBsaWVkIHRvIEFMTCBMYW1iZGEgZnVuY3Rpb25zLlxuICAgICAqIFRoaXMgcmVwbGFjZXMgYW55IGV4aXN0aW5nIGdsb2JhbCByZXNvdXJjZSBhY2Nlc3MgY29uZmlndXJhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGZ3MjQuc2V0R2xvYmFsUmVzb3VyY2VBY2Nlc3Moe1xuICAgICAqICAgdGFibGVzOiBbJ3VzZXJzLXRhYmxlJywgeyBuYW1lOiAnb3JkZXJzLXRhYmxlJywgYWNjZXNzOiBbJ3JlYWQnXSB9XSxcbiAgICAgKiAgIGJ1Y2tldHM6IFsnYXNzZXRzLWJ1Y2tldCddLFxuICAgICAqICAgcXVldWVzOiBbJ25vdGlmaWNhdGlvbnMtcXVldWUnXSxcbiAgICAgKiAgIHRvcGljczogWydldmVudHMtdG9waWMnXVxuICAgICAqIH0pO1xuICAgICAqIFxuICAgICAqIEBwYXJhbSByZXNvdXJjZUFjY2VzcyBUaGUgcmVzb3VyY2UgYWNjZXNzIGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICBzZXRHbG9iYWxSZXNvdXJjZUFjY2VzcyhyZXNvdXJjZUFjY2VzczogSUZ1bmN0aW9uUmVzb3VyY2VBY2Nlc3MpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJzZXRHbG9iYWxSZXNvdXJjZUFjY2VzczpcIiwgcmVzb3VyY2VBY2Nlc3MpO1xuICAgICAgICB0aGlzLmdsb2JhbFJlc291cmNlQWNjZXNzID0gcmVzb3VyY2VBY2Nlc3M7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQWRkIHRvIGdsb2JhbCByZXNvdXJjZSBhY2Nlc3MgY29uZmlndXJhdGlvbi5cbiAgICAgKiBUaGlzIG1lcmdlcyB3aXRoIGV4aXN0aW5nIGdsb2JhbCByZXNvdXJjZSBhY2Nlc3MgY29uZmlndXJhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGZ3MjQuYWRkR2xvYmFsUmVzb3VyY2VBY2Nlc3Moe1xuICAgICAqICAgdGFibGVzOiBbJ3VzZXJzLXRhYmxlJ10sXG4gICAgICogICBidWNrZXRzOiBbJ2Fzc2V0cy1idWNrZXQnXVxuICAgICAqIH0pO1xuICAgICAqIFxuICAgICAqIEBwYXJhbSByZXNvdXJjZUFjY2VzcyBUaGUgcmVzb3VyY2UgYWNjZXNzIHRvIGFkZFxuICAgICAqL1xuICAgIGFkZEdsb2JhbFJlc291cmNlQWNjZXNzKHJlc291cmNlQWNjZXNzOiBQYXJ0aWFsPElGdW5jdGlvblJlc291cmNlQWNjZXNzPikge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImFkZEdsb2JhbFJlc291cmNlQWNjZXNzOlwiLCByZXNvdXJjZUFjY2Vzcyk7XG4gICAgICAgIFxuICAgICAgICBpZiAocmVzb3VyY2VBY2Nlc3MudGFibGVzKSB7XG4gICAgICAgICAgICB0aGlzLmdsb2JhbFJlc291cmNlQWNjZXNzLnRhYmxlcyA9IFtcbiAgICAgICAgICAgICAgICAuLi4odGhpcy5nbG9iYWxSZXNvdXJjZUFjY2Vzcy50YWJsZXMgfHwgW10pLFxuICAgICAgICAgICAgICAgIC4uLnJlc291cmNlQWNjZXNzLnRhYmxlc1xuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHJlc291cmNlQWNjZXNzLmJ1Y2tldHMpIHtcbiAgICAgICAgICAgIHRoaXMuZ2xvYmFsUmVzb3VyY2VBY2Nlc3MuYnVja2V0cyA9IFtcbiAgICAgICAgICAgICAgICAuLi4odGhpcy5nbG9iYWxSZXNvdXJjZUFjY2Vzcy5idWNrZXRzIHx8IFtdKSxcbiAgICAgICAgICAgICAgICAuLi5yZXNvdXJjZUFjY2Vzcy5idWNrZXRzXG4gICAgICAgICAgICBdO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAocmVzb3VyY2VBY2Nlc3MucXVldWVzKSB7XG4gICAgICAgICAgICB0aGlzLmdsb2JhbFJlc291cmNlQWNjZXNzLnF1ZXVlcyA9IFtcbiAgICAgICAgICAgICAgICAuLi4odGhpcy5nbG9iYWxSZXNvdXJjZUFjY2Vzcy5xdWV1ZXMgfHwgW10pLFxuICAgICAgICAgICAgICAgIC4uLnJlc291cmNlQWNjZXNzLnF1ZXVlc1xuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHJlc291cmNlQWNjZXNzLnRvcGljcykge1xuICAgICAgICAgICAgdGhpcy5nbG9iYWxSZXNvdXJjZUFjY2Vzcy50b3BpY3MgPSBbXG4gICAgICAgICAgICAgICAgLi4uKHRoaXMuZ2xvYmFsUmVzb3VyY2VBY2Nlc3MudG9waWNzIHx8IFtdKSxcbiAgICAgICAgICAgICAgICAuLi5yZXNvdXJjZUFjY2Vzcy50b3BpY3NcbiAgICAgICAgICAgIF07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgZ2xvYmFsIHJlc291cmNlIGFjY2VzcyBjb25maWd1cmF0aW9uLlxuICAgICAqIEByZXR1cm5zIFRoZSBnbG9iYWwgcmVzb3VyY2UgYWNjZXNzIGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICBnZXRHbG9iYWxSZXNvdXJjZUFjY2VzcygpOiBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcyB7XG4gICAgICAgIHJldHVybiB0aGlzLmdsb2JhbFJlc291cmNlQWNjZXNzO1xuICAgIH1cblxuICAgIHNldFBvbGljeShwb2xpY3lOYW1lOiBzdHJpbmcsIHZhbHVlOiBQb2xpY3lTdGF0ZW1lbnRQcm9wcyB8IFBvbGljeVN0YXRlbWVudCwgcHJlZml4OiBzdHJpbmcgPSAnJykge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcInNldFBvbGljeTpcIiwgcHJlZml4LCBwb2xpY3lOYW1lLCB2YWx1ZSk7XG4gICAgICAgIGNvbnN0IHBvbGljeUtleSA9IGVuc3VyZVZhbGlkRW52S2V5KHBvbGljeU5hbWUsIHByZWZpeCk7XG4gICAgICAgIGlmICh0aGlzLnBvbGljeVN0YXRlbWVudHMuaGFzKHBvbGljeUtleSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFBvbGljeSAke3BvbGljeU5hbWV9IGFscmVhZHkgZXhpc3RzIGluIGZ3MjQgc2NvcGUuIE92ZXJ3cml0aW5nIHdpdGggbmV3IHBvbGljeS5gKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnBvbGljeVN0YXRlbWVudHMuc2V0KHBvbGljeUtleSwgdmFsdWUpO1xuICAgIH1cblxuICAgIGdldFBvbGljeShwb2xpY3lOYW1lOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nID0gJycpOiBQb2xpY3lTdGF0ZW1lbnRQcm9wcyB8IFBvbGljeVN0YXRlbWVudCB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHJldHVybiB0aGlzLnBvbGljeVN0YXRlbWVudHMuZ2V0KGVuc3VyZVZhbGlkRW52S2V5KHBvbGljeU5hbWUsIHByZWZpeCkpO1xuICAgIH1cblxuICAgIGhhc1BvbGljeShwb2xpY3lOYW1lOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nID0gJycpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucG9saWN5U3RhdGVtZW50cy5oYXMoZW5zdXJlVmFsaWRFbnZLZXkocG9saWN5TmFtZSwgcHJlZml4KSk7XG4gICAgfVxuXG4gICAgLy8gc2V0IHRoZSBvdXRwdXQgb2YgYSBjb25zdHJ1Y3RcbiAgICAvLyBpZiBleHBvcnRWYWx1ZUFsaWFzIGlzIG5vdCBwcm92aWRlZCwgdGhlIGV4cG9ydCB2YWx1ZSBrZXkgd2lsbCBiZSB1c2VkIGFzIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZSBrZXkuIGkuZSB3aGVuIHVzaW5nIGN1c3RvbSByZXNvdXJjZSBsaWtlIENmbklkZW50aXR5UG9vbCBcbiAgICAvLyB0aGUgb3V0cHV0IGlzIHRoZSByZWZlcmVuY2UgdG8gdGhlIGN1c3RvbSByZXNvdXJjZS4gVGhlIHJlZmVyZW5jZSBpcyBub3QgdGhlIHBoeXNpY2FsIGlkIG9mIHRoZSBjdXN0b20gcmVzb3VyY2UsIGJ1dCBhIGxvZ2ljYWwgaWRcbiAgICAvLyB0aGF0IGlzIHJlc29sdmVkIHRvIHRoZSBwaHlzaWNhbCBpZCBhdCBydW50aW1lLiBJbiB0aGlzIGNhc2UsIHRoZSBleHBvcnRWYWx1ZUFsaWFzIGlzIHRoZSBrZXkgbmFtZSBvZiB0aGUgY3VzdG9tIHJlc291cmNlLlxuICAgIHNldENvbnN0cnVjdE91dHB1dChjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QsIGtleTogc3RyaW5nLCB2YWx1ZTogYW55LCBvdXRwdXRUeXBlPzogT3V0cHV0VHlwZSwgZXhwb3J0VmFsdWVLZXk/OiBzdHJpbmcsIGV4cG9ydFZhbHVlQWxpYXM/OiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHNldENvbnN0cnVjdE91dHB1dDogJHtjb25zdHJ1Y3QubmFtZX1gLCB7IG91dHB1dFR5cGUsIGtleSB9KTtcbiAgICAgICAgaWYgKG91dHB1dFR5cGUpIHtcbiAgICAgICAgICAgIGNvbnN0cnVjdC5vdXRwdXQgPSB7XG4gICAgICAgICAgICAgICAgLi4uY29uc3RydWN0Lm91dHB1dCxcbiAgICAgICAgICAgICAgICBbIG91dHB1dFR5cGUgXToge1xuICAgICAgICAgICAgICAgICAgICAuLi5jb25zdHJ1Y3Qub3V0cHV0Py5bIG91dHB1dFR5cGUgXSxcbiAgICAgICAgICAgICAgICAgICAgWyBrZXkgXTogdmFsdWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLnNldEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSwgYCR7Y29uc3RydWN0Lm5hbWV9XyR7b3V0cHV0VHlwZX1gKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBzZXRFbnZpcm9ubWVudFZhcmlhYmxlOiAke2tleX1gLCB7IHByZWZpeDogYCR7Y29uc3RydWN0Lm5hbWV9XyR7b3V0cHV0VHlwZX1gIH0pO1xuXG4gICAgICAgICAgICAvLyBpbiBjYXNlIG9mIG9iamVjdCByZWZlcmVuY2UsIGV4cG9ydCB0aGUgb3V0cHV0IHRvIGJlIHVzZWQgaW4gb3RoZXIgc3RhY2tzXG4gICAgICAgICAgICBsZXQgb3V0cHV0VmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIGV4cG9ydFZhbHVlS2V5KSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0VmFsdWUgPSB2YWx1ZVsgZXhwb3J0VmFsdWVLZXkgXTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiBleHBvcnRWYWx1ZUtleSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDcmVhdGUgQ2xvdWRGb3JtYXRpb24gZXhwb3J0IHdpdGggdmFsaWQgbmFtaW5nXG4gICAgICAgICAgICBjb25zdCBzYW5pdGl6ZWRLZXkgPSBlbnN1cmVWYWxpZEVudktleShrZXksICcnLCAnJywgdHJ1ZSk7XG4gICAgICAgICAgICBjb25zdCBleHBvcnRLZXkgPSBgJHtvdXRwdXRUeXBlfSR7c2FuaXRpemVkS2V5fSR7ZXhwb3J0VmFsdWVBbGlhcyB8fCBleHBvcnRWYWx1ZUtleX1gO1xuICAgICAgICAgICAgY29uc3Qgc3RhY2tFeHBvcnROYW1lID0gYCR7Y29uc3RydWN0Lm1haW5TdGFjay5zdGFja05hbWV9LSR7ZXhwb3J0S2V5fWA7XG5cbiAgICAgICAgICAgIG5ldyBDZm5PdXRwdXQoY29uc3RydWN0Lm1haW5TdGFjaywgZXhwb3J0S2V5LCB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IG91dHB1dFZhbHVlLFxuICAgICAgICAgICAgICAgIGV4cG9ydE5hbWU6IHN0YWNrRXhwb3J0TmFtZSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBzZXQgdGhlIGVudmlyb25tZW50IHZhcmlhYmxlIGZvciB0aGUgZGlyZWN0IHJlZmVyZW5jZVxuICAgICAgICAgICAgdGhpcy5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGAke2tleX1fJHtleHBvcnRWYWx1ZUFsaWFzIHx8IGV4cG9ydFZhbHVlS2V5fWAsIG91dHB1dFZhbHVlLCBvdXRwdXRUeXBlKTtcbiAgICAgICAgICAgIC8vIFN0b3JlIFNTTSBwYXJhbWV0ZXIgZm9yIGNyb3NzLXN0YWNrIHJlZmVyZW5jZVxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHVzZU11bHRpU3RhY2tTZXR1cDogJHt0aGlzLnVzZU11bHRpU3RhY2tTZXR1cCgpfWApO1xuICAgICAgICAgICAgaWYgKHRoaXMudXNlTXVsdGlTdGFja1NldHVwKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzc21LZXkgPSBgLyR7Y29uc3RydWN0Lm1haW5TdGFjay5zdGFja05hbWV9LyR7b3V0cHV0VHlwZX0vJHtzYW5pdGl6ZWRLZXl9LyR7ZXhwb3J0VmFsdWVBbGlhcyB8fCBleHBvcnRWYWx1ZUtleX1gO1xuICAgICAgICAgICAgICAgIC8vIHNldCB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUgZm9yIHRoZSBjcm9zcy1zdGFjayByZWZlcmVuY2UgdXNpbmcgU1NNIHBhcmFtZXRlclxuICAgICAgICAgICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShgJHtrZXl9XyR7ZXhwb3J0VmFsdWVBbGlhcyB8fCBleHBvcnRWYWx1ZUtleX1gLCBzc21LZXksIGBTU006JHtvdXRwdXRUeXBlfWApO1xuICAgICAgICAgICAgICAgIG5ldyBTdHJpbmdQYXJhbWV0ZXIoY29uc3RydWN0Lm1haW5TdGFjaywgYFNTTSR7b3V0cHV0VHlwZX0ke3Nhbml0aXplZEtleX0ke2V4cG9ydFZhbHVlQWxpYXMgfHwgZXhwb3J0VmFsdWVLZXl9YCwge1xuICAgICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJOYW1lOiBzc21LZXksXG4gICAgICAgICAgICAgICAgICAgIHN0cmluZ1ZhbHVlOiBvdXRwdXRWYWx1ZSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3RydWN0Lm91dHB1dCA9IHtcbiAgICAgICAgICAgICAgICAuLi5jb25zdHJ1Y3Qub3V0cHV0LFxuICAgICAgICAgICAgICAgIFsga2V5IF06IHZhbHVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLnNldEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSwgY29uc3RydWN0Lm5hbWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWRkRHluYW1vVGFibGUobmFtZTogc3RyaW5nLCB0YWJsZTogVGFibGVWMikge1xuICAgICAgICBuYW1lID0gZW5zdXJlTm9TcGVjaWFsQ2hhcnMobmFtZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiYWRkRHluYW1vVGFibGU6XCIsIHsgbmFtZSB9KTtcbiAgICAgICAgdGhpcy5keW5hbW9UYWJsZXNbIG5hbWUgXSA9IHRhYmxlO1xuICAgIH1cblxuICAgIGdldER5bmFtb1RhYmxlKG5hbWU6IHN0cmluZyk6IFRhYmxlVjIge1xuICAgICAgICByZXR1cm4gdGhpcy5keW5hbW9UYWJsZXNbIGVuc3VyZU5vU3BlY2lhbENoYXJzKG5hbWUpIF07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0cyBhIHF1ZXVlIHJlZmVyZW5jZSBieSBuYW1lLCBmb2xsb3dpbmcgdGhlIGZyYW1ld29yaydzIHBhdHRlcm4gZm9yIGV4aXN0aW5nIHJlc291cmNlIHJlZmVyZW5jZXMuXG4gICAgICogQHBhcmFtIHF1ZXVlTmFtZSBUaGUgbmFtZSBvZiB0aGUgcXVldWVcbiAgICAgKiBAcGFyYW0gc2NvcGUgT3B0aW9uYWwgc2NvcGUgZm9yIHN0YWNrIHJlc29sdXRpb24gXG4gICAgICogQHBhcmFtIGNvbnN0cnVjdElkIE9wdGlvbmFsIGNvbnN0cnVjdCBJRCBmb3IgdW5pcXVlIG5hbWluZ1xuICAgICAqIEByZXR1cm5zIFF1ZXVlIGluc3RhbmNlIHJlZmVyZW5jZWQgYnkgQVJOXG4gICAgICovXG4gICAgZ2V0UXVldWVCeU5hbWUocXVldWVOYW1lOiBzdHJpbmcsIHNjb3BlPzogYW55LCBjb25zdHJ1Y3RJZD86IHN0cmluZyk6IElRdWV1ZSB7XG4gICAgICAgIGNvbnN0IHF1ZXVlVXJsID0gdGhpcy5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHF1ZXVlTmFtZSArICdfcXVldWVOYW1lJywgJ3F1ZXVlJywgc2NvcGUpO1xuICAgICAgICBjb25zdCBxdWV1ZUFybiA9IHRoaXMuZ2V0QXJuKCdzcXMnLCBxdWV1ZVVybCk7XG4gICAgICAgIGNvbnN0IHVuaXF1ZUlkID0gY29uc3RydWN0SWQgPyBgJHtjb25zdHJ1Y3RJZH0tJHtxdWV1ZU5hbWV9LXF1ZXVlYCA6IGAke3F1ZXVlTmFtZX0tcXVldWVgO1xuICAgICAgICByZXR1cm4gUXVldWUuZnJvbVF1ZXVlQXJuKHNjb3BlID8/IHRoaXMuZ2V0U3RhY2soKSwgdW5pcXVlSWQsIHF1ZXVlQXJuKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXRzIGEgdG9waWMgcmVmZXJlbmNlIGJ5IG5hbWUsIGZvbGxvd2luZyB0aGUgZnJhbWV3b3JrJ3MgcGF0dGVybiBmb3IgZXhpc3RpbmcgcmVzb3VyY2UgcmVmZXJlbmNlcy5cbiAgICAgKiBAcGFyYW0gdG9waWNOYW1lIFRoZSBuYW1lIG9mIHRoZSB0b3BpY1xuICAgICAqIEBwYXJhbSBzY29wZSBPcHRpb25hbCBzY29wZSBmb3Igc3RhY2sgcmVzb2x1dGlvblxuICAgICAqIEBwYXJhbSBjb25zdHJ1Y3RJZCBPcHRpb25hbCBjb25zdHJ1Y3QgSUQgZm9yIHVuaXF1ZSBuYW1pbmcgIFxuICAgICAqIEByZXR1cm5zIFRvcGljIGluc3RhbmNlIHJlZmVyZW5jZWQgYnkgQVJOXG4gICAgICovXG4gICAgZ2V0VG9waWNCeU5hbWUodG9waWNOYW1lOiBzdHJpbmcsIHNjb3BlPzogYW55LCBjb25zdHJ1Y3RJZD86IHN0cmluZyk6IElUb3BpYyB7XG4gICAgICAgIGNvbnN0IHRvcGljQXJuVmFsdWUgPSB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUodG9waWNOYW1lLCAndG9waWNOYW1lJyk7XG4gICAgICAgIGNvbnN0IHRvcGljQXJuID0gdGhpcy5nZXRBcm4oJ3NucycsIHRvcGljQXJuVmFsdWUpO1xuICAgICAgICBjb25zdCB1bmlxdWVJZCA9IGNvbnN0cnVjdElkID8gYCR7Y29uc3RydWN0SWR9LSR7dG9waWNOYW1lfS10b3BpY2AgOiBgJHt0b3BpY05hbWV9LXRvcGljYDtcbiAgICAgICAgcmV0dXJuIFRvcGljLmZyb21Ub3BpY0FybihzY29wZSA/PyB0aGlzLmdldFN0YWNrKCksIHVuaXF1ZUlkLCB0b3BpY0Fybik7XG4gICAgfVxuXG4gICAgYWRkUm91dGVUb1JvbGVQb2xpY3kocm91dGU6IHN0cmluZywgZ3JvdXBzOiBzdHJpbmdbXSwgcmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgICAgIGlmICghZ3JvdXBzIHx8IGdyb3Vwcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGdyb3VwcyA9IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnR3JvdXBzJywgJ2NvZ25pdG8nKTtcbiAgICAgICAgICAgIGlmICghZ3JvdXBzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gZ3JvdXBzIGRlZmluZWQuIEFkZGluZyByb3V0ZTogJHtyb3V0ZX0gdG8gcm9sZSBwb2xpY3kgZm9yIGRlZmF1bHQgYXV0aGVudGljYXRlZCByb2xlLmApO1xuICAgICAgICAgICAgICAgIGdyb3VwcyA9IFsgJ2RlZmF1bHQnIF07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgbGV0IHJvdXRlQWRkZWRUb0dyb3VwUG9saWN5ID0gZmFsc2U7XG4gICAgICAgIGZvciAoY29uc3QgZ3JvdXBOYW1lIG9mIGdyb3Vwcykge1xuICAgICAgICAgICAgLy8gaWYgcmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyBpcyB0cnVlLCBjaGVjayBpZiB0aGUgcm91dGUgaXMgaW4gdGhlIGdyb3VwIGNvbmZpZ1xuICAgICAgICAgICAgaWYgKHJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgJiYgKCF0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUoJ1JvdXRlcycsICdjb2duaXRvXycgKyBncm91cE5hbWUpPy5pbmNsdWRlcyhyb3V0ZSkpKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBnZXQgcm9sZVxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhZGRSb3V0ZVRvUm9sZVBvbGljeTpcIiwgeyByb3V0ZSwgZ3JvdXBOYW1lIH0pO1xuICAgICAgICAgICAgY29uc3Qgcm9sZTogUm9sZSA9IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnUm9sZScsICdjb2duaXRvXycgKyBncm91cE5hbWUpO1xuICAgICAgICAgICAgaWYgKCFyb2xlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFJvbGUgbm90IGZvdW5kIGZvciBncm91cDogJHtncm91cE5hbWV9LiBSb2xlIGlzIHJlcXVpcmVkIHRvIGFkZCByb3V0ZTogJHtyb3V0ZX0gdG8gcm9sZSBwb2xpY3kuIFBsZWFzZSBtYWtlIHN1cmUgeW91IGhhdmUgYSBncm91cCBkZWZpbmVkIGluIHlvdXIgY29uZmlnIHdpdGggdGhlIG5hbWU6ICR7Z3JvdXBOYW1lfS5gKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBhZGQgcm9sZSBwb2xpY3kgc3RhdGVtZW50IHRvIGFsbG93IHJvdXRlIGFjY2VzcyBmb3IgZ3JvdXBcbiAgICAgICAgICAgIHJvbGUuYWRkVG9Qb2xpY3kodGhpcy5nZXRSb3V0ZVBvbGljeVN0YXRlbWVudChyb3V0ZSkpO1xuICAgICAgICAgICAgcm91dGVBZGRlZFRvR3JvdXBQb2xpY3kgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghcm91dGVBZGRlZFRvR3JvdXBQb2xpY3kpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBSb3V0ZSAke3JvdXRlfSBub3QgZm91bmQgaW4gYW55IGdyb3VwIGNvbmZpZy4gUGxlYXNlIGFkZCB0aGUgcm91dGUgdG8gYSBncm91cCBjb25maWcgdG8gc2VjdXJlIGFjY2Vzcy5gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldFJvdXRlUG9saWN5U3RhdGVtZW50KHJvdXRlOiBzdHJpbmcpIHtcbiAgICAgICAgLy8gd3JpdGUgdGhlIHBvbGljeSBzdGF0ZW1lbnRcbiAgICAgICAgY29uc3Qgc3RhdGVtZW50ID0gbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBlZmZlY3Q6IEVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgIGFjdGlvbnM6IFsgJ2V4ZWN1dGUtYXBpOkludm9rZScgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogWyBgYXJuOmF3czpleGVjdXRlLWFwaToqOio6Ki8qLyovJHtyb3V0ZX1gIF0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiUm91dGVQb2xpY3lTdGF0ZW1lbnQ6XCIsIHsgcm91dGUgfSk7XG5cbiAgICAgICAgcmV0dXJuIHN0YXRlbWVudDtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0Q29uc3RydWN0T3V0cHV0PFQ+KHR5cGU6IE91dHB1dFR5cGUsIG5hbWU6IHN0cmluZyk6IFQgfCB1bmRlZmluZWQge1xuICAgICAgICAvLyBMb29rIHRocm91Z2ggYWxsIGNvbnN0cnVjdHMgdG8gZmluZCB0aGUgb3V0cHV0XG4gICAgICAgIGZvciAoY29uc3QgY29uc3RydWN0IG9mIHRoaXMuY29uc3RydWN0cy52YWx1ZXMoKSkge1xuICAgICAgICAgICAgaWYgKGNvbnN0cnVjdC5vdXRwdXQ/LlsgdHlwZSBdPy5bIG5hbWUgXSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBjb25zdHJ1Y3Qub3V0cHV0WyB0eXBlIF1bIG5hbWUgXSBhcyBUO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgcHVibGljIGFkZENvbnN0cnVjdChjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QpIHtcbiAgICAgICAgdGhpcy5jb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3QubmFtZSwgY29uc3RydWN0KTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0VnBjKHZwY05hbWU6IHN0cmluZyk6IFZwYyB7XG4gICAgICAgIGNvbnN0IHZwYyA9IHRoaXMuZ2V0Q29uc3RydWN0T3V0cHV0PFZwYz4oT3V0cHV0VHlwZS5WUEMsIHZwY05hbWUpO1xuICAgICAgICBpZiAoIXZwYykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBWUEMgJHt2cGNOYW1lfSBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdnBjO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRIb3N0ZWRab25lKGRvbWFpbk5hbWU6IHN0cmluZyk6IElIb3N0ZWRab25lIHtcbiAgICAgICAgLy8gTG9vayB1cCB0aGUgaG9zdGVkIHpvbmUgYnkgZG9tYWluIG5hbWVcbiAgICAgICAgcmV0dXJuIEhvc3RlZFpvbmUuZnJvbUxvb2t1cCh0aGlzLmFwcCwgYCR7ZG9tYWluTmFtZX0tem9uZWAsIHtcbiAgICAgICAgICAgIGRvbWFpbk5hbWUsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHNldEp3dEF1dGhvcml6ZXIoYXV0aG9yaXplcjogSUF1dGhvcml6ZXIsIGRlZmF1bHRBdXRob3JpemVyOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJzZXRKd3RBdXRob3JpemVyOiBcIiwgeyBhdXRob3JpemVyOiBhdXRob3JpemVyLmF1dGhvcml6ZXJJZCB9KTtcbiAgICAgICAgdGhpcy5qd3RBdXRob3JpemVyID0gYXV0aG9yaXplcjtcbiAgICAgICAgaWYgKGRlZmF1bHRBdXRob3JpemVyKSB7XG4gICAgICAgICAgICB0aGlzLmRlZmF1bHRBdXRob3JpemVyID0gYXV0aG9yaXplcjtcbiAgICAgICAgICAgIHRoaXMuZ2V0Q29uZmlnKCkuZGVmYXVsdEF1dGhvcml6YXRpb25UeXBlID0gJ0pXVCc7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRKd3RBdXRob3JpemVyKCk6IElBdXRob3JpemVyIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuand0QXV0aG9yaXplcjtcbiAgICB9XG5cbiAgICBwdWJsaWMgcmVnaXN0ZXJTeXN0ZW1Db250cm9sbGVyKGNvbnRyb2xsZXI6IFN5c3RlbUNvbnRyb2xsZXJEZWZpbml0aW9uKSB7XG4gICAgICAgIHRoaXMuc3lzdGVtQ29udHJvbGxlcnMuc2V0KGNvbnRyb2xsZXIucGF0aCwgY29udHJvbGxlcik7XG4gICAgfVxuICAgIHB1YmxpYyBoYXNTeXN0ZW1Db250cm9sbGVyKHBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gdGhpcy5zeXN0ZW1Db250cm9sbGVycy5oYXMocGF0aCk7XG4gICAgfVxuICAgIHB1YmxpYyBnZXRTeXN0ZW1Db250cm9sbGVyKHBhdGg6IHN0cmluZyk6IFN5c3RlbUNvbnRyb2xsZXJEZWZpbml0aW9uIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3lzdGVtQ29udHJvbGxlcnMuZ2V0KHBhdGgpO1xuICAgIH1cbiAgICBwdWJsaWMgaGFzU3lzdGVtQ29udHJvbGxlcnMoKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5c3RlbUNvbnRyb2xsZXJzLnNpemUgPiAwO1xuICAgIH1cbiAgICBwdWJsaWMgZ2V0U3lzdGVtQ29udHJvbGxlcnMoKTogU3lzdGVtQ29udHJvbGxlckRlZmluaXRpb25bXSB7XG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKHRoaXMuc3lzdGVtQ29udHJvbGxlcnMudmFsdWVzKCkpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyByZWdpc3RlclN5c3RlbVVJQ29uZmlnKG5hbWU6IHN0cmluZywgY29uZmlnOiBTeXN0ZW1VSVBhZ2VEZWZpbml0aW9uKSB7XG4gICAgICAgIHRoaXMuc3lzdGVtVUlDb25maWdzLnNldChuYW1lLCBjb25maWcpO1xuICAgIH1cbiAgICBwdWJsaWMgaGFzU3lzdGVtVUlDb25maWcobmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5c3RlbVVJQ29uZmlncy5oYXMobmFtZSk7XG4gICAgfVxuICAgIHB1YmxpYyBnZXRTeXN0ZW1VSUNvbmZpZyhuYW1lOiBzdHJpbmcpOiBTeXN0ZW1VSVBhZ2VEZWZpbml0aW9uIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3lzdGVtVUlDb25maWdzLmdldChuYW1lKTtcbiAgICB9XG4gICAgcHVibGljIGdldFN5c3RlbVVJQ29uZmlncygpOiBTeXN0ZW1VSVBhZ2VEZWZpbml0aW9uW10ge1xuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbSh0aGlzLnN5c3RlbVVJQ29uZmlncy52YWx1ZXMoKSk7XG4gICAgfVxuICAgIHB1YmxpYyBoYXNTeXN0ZW1VSUNvbmZpZ3MoKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5c3RlbVVJQ29uZmlncy5zaXplID4gMDtcbiAgICB9XG59Il19