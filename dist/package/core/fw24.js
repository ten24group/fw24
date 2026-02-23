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
    simulatedLambdas = new Map();
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
    registerSimulatedLambda(id, config) {
        this.simulatedLambdas.set(id, config);
    }
    getSimulatedLambdas() {
        return this.simulatedLambdas;
    }
}
exports.Fw24 = Fw24;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZncyNC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb3JlL2Z3MjQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBQWlFO0FBSWpFLGlEQUFvRztBQUNwRyx5REFBa0U7QUFFbEUsaURBQTRDO0FBQzVDLGlEQUFvRDtBQUNwRCxpREFBc0Q7QUFDdEQsOEJBQW9DO0FBR3BDLHVEQUFvRTtBQUVwRSx3Q0FBMEM7QUFDMUMsd0NBQXdFO0FBQ3hFLHFDQUFrQztBQUlsQyxNQUFhLElBQUk7SUFDSixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUUxQyxPQUFPLEdBQVcsTUFBTSxDQUFDO0lBQ3pCLGFBQWEsQ0FBTTtJQUVYLE1BQU0sR0FBdUIsRUFBRSxDQUFDO0lBQ2hDLEdBQUcsQ0FBTztJQUNWLE1BQU0sR0FBMEIsRUFBRSxDQUFDO0lBQ25DLElBQUksR0FBZ0UsRUFBRSxDQUFDO0lBQ3ZFLG9CQUFvQixHQUF3QixFQUFFLENBQUM7SUFDdEMsMEJBQTBCLEdBQWEsRUFBRSxDQUFDO0lBQzFDLGNBQWMsR0FBbUQsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUNwRixvQkFBb0IsR0FBNEIsRUFBRSxDQUFDO0lBQzFDLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFrRCxDQUFDO0lBQ3RGLGlCQUFpQixDQUEwQjtJQUMzQyxrQkFBa0IsR0FBcUMsRUFBRSxDQUFDO0lBQzFELGFBQWEsQ0FBMEI7SUFDdkMsWUFBWSxHQUFpQyxFQUFFLENBQUM7SUFDaEQsTUFBTSxDQUFDLFFBQVEsQ0FBTztJQUViLE1BQU0sR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztJQUNuQyxNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQWtCLENBQUM7SUFDbkMsT0FBTyxHQUFHLElBQUksR0FBRyxFQUF1QixDQUFDO0lBQ3pDLFVBQVUsR0FBRyxJQUFJLEdBQUcsRUFBeUIsQ0FBQztJQUU5QyxzQkFB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b3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBcHAsIENmbk91dHB1dCwgTmVzdGVkU3RhY2ssIFN0YWNrIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgSUF1dGhvcml6ZXIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyJztcbmltcG9ydCB7IFRhYmxlVjIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0IHsgVnBjIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgeyBFZmZlY3QsIFBvbGljeVN0YXRlbWVudCwgdHlwZSBQb2xpY3lTdGF0ZW1lbnRQcm9wcywgdHlwZSBSb2xlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBIb3N0ZWRab25lLCBJSG9zdGVkWm9uZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1yb3V0ZTUzJztcbmltcG9ydCB0eXBlIHsgSVRvcGljIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgeyBUb3BpYyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0IHsgSVF1ZXVlLCBRdWV1ZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zcXMnO1xuaW1wb3J0IHsgU3RyaW5nUGFyYW1ldGVyIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNzbSc7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uL2RpJztcbmltcG9ydCB7IHR5cGUgSUxhbWJkYUVudkNvbmZpZyB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgSUFwcGxpY2F0aW9uQ29uZmlnLCBTeXN0ZW1Db250cm9sbGVyRGVmaW5pdGlvbiwgU3lzdGVtVUlQYWdlRGVmaW5pdGlvbiB9IGZyb20gJy4uL2ludGVyZmFjZXMvY29uZmlnJztcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIE91dHB1dFR5cGUgfSBmcm9tICcuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdCc7XG5pbXBvcnQgeyB0eXBlIElESUNvbnRhaW5lciB9IGZyb20gJy4uL2ludGVyZmFjZXMvZGknO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBlbnN1cmVOb1NwZWNpYWxDaGFycywgZW5zdXJlVmFsaWRFbnZLZXkgfSBmcm9tICcuLi91dGlscy9rZXlzJztcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gJy4vaGVscGVyJztcbmltcG9ydCB7IHR5cGUgSUZ3MjRNb2R1bGUgfSBmcm9tICcuL3J1bnRpbWUvbW9kdWxlJztcbmltcG9ydCB0eXBlIHsgVEltcG9ydGVkUG9saWN5LCBUUG9saWN5U3RhdGVtZW50T3JQcm9wcywgSUZ1bmN0aW9uUmVzb3VyY2VBY2Nlc3MgfSBmcm9tICcuLi9jb25zdHJ1Y3RzL2xhbWJkYS1mdW5jdGlvbic7XG5cbmV4cG9ydCBjbGFzcyBGdzI0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoRncyNC5uYW1lKTtcblxuICAgIGFwcE5hbWU6IHN0cmluZyA9IFwiZncyNFwiO1xuICAgIGVtYWlsUHJvdmlkZXI6IGFueTtcblxuICAgIHByaXZhdGUgY29uZmlnOiBJQXBwbGljYXRpb25Db25maWcgPSB7fTtcbiAgICBwcml2YXRlIGFwcCE6IEFwcDtcbiAgICBwcml2YXRlIHN0YWNrczogUmVjb3JkPHN0cmluZywgU3RhY2s+ID0ge307XG4gICAgcHJpdmF0ZSBhcGlzOiB7IFsgYXBpQ29uc3RydWN0TmFtZTogc3RyaW5nIF06IHsgWyBuYW1lOiBzdHJpbmcgXTogYW55IH0gfSA9IHt9O1xuICAgIHByaXZhdGUgZW52aXJvbm1lbnRWYXJpYWJsZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgZ2xvYmFsUG9saWNpZXM6IFNldDxUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeT4gPSBuZXcgU2V0KCk7XG4gICAgcHJpdmF0ZSBnbG9iYWxSZXNvdXJjZUFjY2VzczogSUZ1bmN0aW9uUmVzb3VyY2VBY2Nlc3MgPSB7fTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBvbGljeVN0YXRlbWVudHMgPSBuZXcgTWFwPHN0cmluZywgUG9saWN5U3RhdGVtZW50UHJvcHMgfCBQb2xpY3lTdGF0ZW1lbnQ+KCk7XG4gICAgcHJpdmF0ZSBkZWZhdWx0QXV0aG9yaXplcjogSUF1dGhvcml6ZXIgfCB1bmRlZmluZWQ7XG4gICAgcHJpdmF0ZSBjb2duaXRvQXV0aG9yaXplcnM6IHsgWyBrZXk6IHN0cmluZyBdOiBJQXV0aG9yaXplciB9ID0ge307XG4gICAgcHJpdmF0ZSBqd3RBdXRob3JpemVyOiBJQXV0aG9yaXplciB8IHVuZGVmaW5lZDtcbiAgICBwcml2YXRlIGR5bmFtb1RhYmxlczogeyBbIGtleTogc3RyaW5nIF06IFRhYmxlVjIgfSA9IHt9O1xuICAgIHByaXZhdGUgc3RhdGljIGluc3RhbmNlOiBGdzI0O1xuXG4gICAgcHJpdmF0ZSByZWFkb25seSBxdWV1ZXMgPSBuZXcgTWFwPHN0cmluZywgSVF1ZXVlPigpO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgdG9waWNzID0gbmV3IE1hcDxzdHJpbmcsIElUb3BpYz4oKTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IG1vZHVsZXMgPSBuZXcgTWFwPHN0cmluZywgSUZ3MjRNb2R1bGU+KCk7XG4gICAgcHJpdmF0ZSByZWFkb25seSBjb25zdHJ1Y3RzID0gbmV3IE1hcDxzdHJpbmcsIEZXMjRDb25zdHJ1Y3Q+KCk7XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdsb2JhbExhbWJkYUxheWVyTmFtZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGdsb2JhbExhbWJkYUVudHJ5UGFja2FnZXMgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpOyAvLyBwYWNrYWdlIC0+IHByaW9yaXR5XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IHN5c3RlbVVJQ29uZmlnczogTWFwPHN0cmluZywgU3lzdGVtVUlQYWdlRGVmaW5pdGlvbj4gPSBuZXcgTWFwKCk7XG4gICAgcHJpdmF0ZSByZWFkb25seSBzeXN0ZW1Db250cm9sbGVyczogTWFwPHN0cmluZywgU3lzdGVtQ29udHJvbGxlckRlZmluaXRpb24+ID0gbmV3IE1hcCgpO1xuXG4gICAgcHJpdmF0ZSByZWFkb25seSBzaW11bGF0ZWRMYW1iZGFzID0gbmV3IE1hcDxzdHJpbmcsIGFueT4oKTtcblxuICAgIHByaXZhdGUgY29uc3RydWN0b3IoKSB7IH0gLy8gRW1wdHkgY29uc3RydWN0b3IgYXMgQXBwIGlzIHNldCB2aWEgc2V0QXBwKClcblxuICAgIHN0YXRpYyBnZXRJbnN0YW5jZSgpOiBGdzI0IHtcbiAgICAgICAgaWYgKCFGdzI0Lmluc3RhbmNlKSB7XG4gICAgICAgICAgICBGdzI0Lmluc3RhbmNlID0gbmV3IEZ3MjQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBGdzI0Lmluc3RhbmNlO1xuICAgIH1cblxuICAgIHNldEFwcChhcHA6IEFwcCkge1xuICAgICAgICB0aGlzLmFwcCA9IGFwcDtcbiAgICB9XG5cbiAgICBnZXRBcHAoKTogQXBwIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuYXBwO1xuICAgIH1cblxuICAgIHNldENvbmZpZyhjb25maWc6IElBcHBsaWNhdGlvbkNvbmZpZykge1xuICAgICAgICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgICAgICAgLy8gSHlkcmF0ZSB0aGUgY29uZmlnIG9iamVjdCB3aXRoIGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyh0aGlzLmNvbmZpZyk7XG4gICAgICAgIC8vIFNldCB0aGUgYXBwIG5hbWVcbiAgICAgICAgdGhpcy5hcHBOYW1lID0gY29uZmlnLm5hbWUhO1xuICAgIH1cblxuICAgIGdldENvbmZpZygpOiBJQXBwbGljYXRpb25Db25maWcge1xuICAgICAgICByZXR1cm4gdGhpcy5jb25maWc7XG4gICAgfVxuXG4gICAgZ2V0QXBwRElDb250YWluZXIoKTogSURJQ29udGFpbmVyIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmFwcERJQ29udGFpbmVyIHx8IERJQ29udGFpbmVyLlJPT1Q7XG4gICAgfVxuXG4gICAgZ2V0TGFtYmRhRW50cnlQYWNrYWdlcygpOiBzdHJpbmdbXSB7XG4gICAgICAgIGlmICh0aGlzLmNvbmZpZy5sYW1iZGFFbnRyeVBhY2thZ2VzKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jb25maWcubGFtYmRhRW50cnlQYWNrYWdlcztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNvcnQgZW50cnkgcGFja2FnZXMgYnkgcHJpb3JpdHkgKGxvd2VyIG51bWJlciA9IGxvYWRlZCBmaXJzdClcbiAgICAgICAgcmV0dXJuIEFycmF5LmZyb20odGhpcy5nbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2VzLmVudHJpZXMoKSlcbiAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBhWyAxIF0gLSBiWyAxIF0pICAvLyBTb3J0IGJ5IHByaW9yaXR5XG4gICAgICAgICAgICAubWFwKChbIHBhY2thZ2VOYW1lIF0pID0+IHBhY2thZ2VOYW1lKTtcbiAgICB9XG5cbiAgICBhZGRHbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2UocGFja2FnZU5hbWU6IHN0cmluZywgcHJpb3JpdHk6IG51bWJlciA9IDk5OSkge1xuICAgICAgICB0aGlzLmdsb2JhbExhbWJkYUVudHJ5UGFja2FnZXMuc2V0KHBhY2thZ2VOYW1lLCBwcmlvcml0eSk7XG4gICAgfVxuXG4gICAgaGFzR2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlKHBhY2thZ2VOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlcy5oYXMocGFja2FnZU5hbWUpO1xuICAgIH1cblxuICAgIHJlbW92ZUdsb2JhbExhbWJkYUVudHJ5UGFja2FnZShwYWNrYWdlTmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuZ2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlcy5kZWxldGUocGFja2FnZU5hbWUpO1xuICAgIH1cblxuICAgIGdldEdsb2JhbExhbWJkYUxheWVyTmFtZXMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdsb2JhbExhbWJkYUxheWVyTmFtZXM7XG4gICAgfVxuXG4gICAgYWRkR2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyhsYXllck5hbWU6IHN0cmluZykge1xuICAgICAgICB0aGlzLmdsb2JhbExhbWJkYUxheWVyTmFtZXMuYWRkKGxheWVyTmFtZSk7XG4gICAgfVxuXG4gICAgaGFzR2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyhsYXllck5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5nbG9iYWxMYW1iZGFMYXllck5hbWVzLmhhcyhsYXllck5hbWUpO1xuICAgIH1cblxuICAgIHJlbW92ZUdsb2JhbExhbWJkYUxheWVyTmFtZXMobGF5ZXJOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5nbG9iYWxMYW1iZGFMYXllck5hbWVzLmRlbGV0ZShsYXllck5hbWUpO1xuICAgIH1cblxuICAgIGFkZFN0YWNrKG5hbWU6IHN0cmluZywgc3RhY2s6IGFueSk6IHRoaXMge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImFkZFN0YWNrOlwiLCB7IG5hbWUgfSk7XG4gICAgICAgIHRoaXMuc3RhY2tzWyBuYW1lIF0gPSBzdGFjaztcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBHZXQgYSBzdGFjayBieSBuYW1lLiBJZiB0aGUgc3RhY2sgZG9lcyBub3QgZXhpc3QsIGNyZWF0ZSBpdC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gbmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBzdGFjayB0byBnZXQuXG4gICAgICogQHBhcmFtIHBhcmVudFN0YWNrTmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBwYXJlbnQgc3RhY2suXG4gICAgICogQHJldHVybnMgVGhlIHN0YWNrLlxuICAgICAqL1xuICAgIGdldFN0YWNrKG5hbWU/OiBzdHJpbmcsIHBhcmVudFN0YWNrTmFtZT86IHN0cmluZyk6IGFueSB7XG4gICAgICAgIGxldCBzdGFja05hbWU6IHN0cmluZyA9IG5hbWUgfHwgdGhpcy5nZXREZWZhdWx0U3RhY2tOYW1lKCk7XG4gICAgICAgIC8vIGRvbid0IGFsbG93IG5lc3RlZCBzdGFja3MgaWYgbXVsdGlTdGFjayBpcyB0cnVlLCBtdWx0aXN0YWNrIGlzIHVzZWQgZm9yIGNyZWF0aW5nIGluZGVwZW5kZW50IHN0YWNrc1xuICAgICAgICBpZiAodGhpcy5jb25maWcubXVsdGlTdGFjayAmJiBwYXJlbnRTdGFja05hbWUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTmVzdGVkIHN0YWNrcyBhcmUgbm90IGFsbG93ZWQgd2hlbiBtdWx0aVN0YWNrIGlzIHRydWUuIFBsZWFzZSB1c2UgbXVsdGlTdGFjazogZmFsc2Ugb3IgcmVtb3ZlIHRoZSBwYXJlbnRTdGFja05hbWUgcGFyYW1ldGVyLicpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGlmIHRoZSBzdGFjayBkb2VzIG5vdCBleGlzdCBhbmQgbXVsdGlTdGFjayBpcyBmYWxzZSBhbmQgcGFyZW50U3RhY2tOYW1lIGlzIG5vdCBwcm92aWRlZCwgdGhlbiB1c2UgdGhlIGRlZmF1bHQgc3RhY2sgbmFtZVxuICAgICAgICBpZiAodGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdID09PSB1bmRlZmluZWQgJiYgISh0aGlzLmNvbmZpZy5tdWx0aVN0YWNrIHx8IHBhcmVudFN0YWNrTmFtZSkpIHtcbiAgICAgICAgICAgIHN0YWNrTmFtZSA9IHRoaXMuZ2V0RGVmYXVsdFN0YWNrTmFtZSgpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiR2V0dGluZyBTdGFjayBXaXRoIE5hbWU6XCIsIHsgc3RhY2tOYW1lIH0pO1xuICAgICAgICBpZiAodGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGlmIChwYXJlbnRTdGFja05hbWUpIHtcbiAgICAgICAgICAgICAgICAvLyBjcmVhdGUgYSBuZXcgbmVzdGVkIHN0YWNrXG4gICAgICAgICAgICAgICAgdGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdID0gbmV3IE5lc3RlZFN0YWNrKHRoaXMuZ2V0U3RhY2socGFyZW50U3RhY2tOYW1lKSwgc3RhY2tOYW1lKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNyZWF0ZWQgbmVzdGVkIHN0YWNrOlwiLCB7IHN0YWNrTmFtZSwgcGFyZW50U3RhY2tOYW1lIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsZXQgc3RhY2tJRCA9IGAke3RoaXMuYXBwTmFtZX0tJHtzdGFja05hbWV9LXN0YWNrYDtcbiAgICAgICAgICAgICAgICAvLyBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eSBmb3Igb2xkIHN0YWNrIG5hbWVzXG4gICAgICAgICAgICAgICAgaWYgKHN0YWNrTmFtZSA9PT0gJ3ByZW11bHRpc3RhY2snKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0YWNrSUQgPSBgJHt0aGlzLmFwcE5hbWV9LXN0YWNrYDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gY3JlYXRlIGEgbmV3IHN0YWNrXG4gICAgICAgICAgICAgICAgdGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdID0gbmV3IFN0YWNrKHRoaXMuYXBwLCBzdGFja0lELCB7XG4gICAgICAgICAgICAgICAgICAgIGVudjoge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWNjb3VudDogdGhpcy5jb25maWcuYWNjb3VudCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lvbjogdGhpcy5jb25maWcucmVnaW9uXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAvLyBtYWtlIGFsbCBzdGFja3MgZGVwZW5kZW50IG9uIHRoZSBsYXllciBzdGFja1xuICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyU3RhY2sgPSB0aGlzLmdldFN0YWNrKHRoaXMuY29uZmlnLmxheWVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgICAgICBpZiAobGF5ZXJTdGFjaykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YWNrc1sgc3RhY2tOYW1lIF0uYWRkRGVwZW5kZW5jeShsYXllclN0YWNrKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGVkIHN0YWNrOlwiLCB7IHN0YWNrTmFtZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5zdGFja3NbIHN0YWNrTmFtZSBdO1xuICAgIH1cblxuICAgIGdldERlZmF1bHRTdGFja05hbWUoKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRlZmF1bHRTdGFja05hbWUgfHwgJ21haW4nO1xuICAgIH1cblxuICAgIHVzZU11bHRpU3RhY2tTZXR1cCA9IChjdXJyZW50U3RhY2tOYW1lPzogc3RyaW5nLCByZXNvdXJjZVN0YWNrPzogU3RhY2spOiBib29sZWFuID0+IHtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgIHRoaXMuZ2V0Q29uZmlnKCkubXVsdGlTdGFja1xuICAgICAgICAgICAgJiYgdGhpcy5nZXRDb25maWcoKS5tdWx0aVN0YWNrID09PSB0cnVlXG4gICAgICAgICAgICAmJiAoXG4gICAgICAgICAgICAgICAgLy8gaWYgcmVzb3VyY2Ugc3RhY2sgaXMgbm90IHByb3ZpZGVkLCB0aGVuIG9ubHkgY2hlY2sgaWYgbXVsdGktc3RhY2sgaXMgZW5hYmxlZFxuICAgICAgICAgICAgICAgICFyZXNvdXJjZVN0YWNrIHx8XG4gICAgICAgICAgICAgICAgLy8gaWYgcmVzb3VyY2Ugc3RhY2sgaXMgcHJvdmlkZWQsIHRoZW4gY2hlY2sgaWYgaXQgaXMgYSBkaWZmZXJlbnQgc3RhY2sgdGhhbiB0aGUgY3VycmVudCBzdGFja1xuICAgICAgICAgICAgICAgICEocmVzb3VyY2VTdGFjaz8uc3RhY2tOYW1lLmVuZHNXaXRoKGN1cnJlbnRTdGFja05hbWUgKyAnLXN0YWNrJykgfHwgcmVzb3VyY2VTdGFjaz8uc3RhY2tOYW1lID09PSBjdXJyZW50U3RhY2tOYW1lKVxuICAgICAgICAgICAgKVxuICAgICAgICApIHx8IGZhbHNlO1xuICAgIH1cblxuICAgIGFkZEFQSShhcGlDb25zdHJ1Y3ROYW1lOiBzdHJpbmcsIG5hbWU6IHN0cmluZywgYXBpOiBhbnksIGlzSW1wb3J0ZWQ6IGJvb2xlYW4gPSBmYWxzZSk6IHRoaXMge1xuICAgICAgICAvLyBJbml0aWFsaXplIHRoZSBhcGlDb25zdHJ1Y3ROYW1lIG9iamVjdCBpZiBpdCBkb2Vzbid0IGV4aXN0XG4gICAgICAgIGlmICghdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF0pIHtcbiAgICAgICAgICAgIHRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdID0ge307XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhZGRBUEk6XCIsIHsgbmFtZSB9KTtcbiAgICAgICAgdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF1bIG5hbWUgXSA9IHsgYXBpOiBhcGksIGlzSW1wb3J0ZWQ6IGlzSW1wb3J0ZWQgfTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZ2V0QVBJKGFwaUNvbnN0cnVjdE5hbWU6IHN0cmluZywgbmFtZTogc3RyaW5nKTogYW55IHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgQVBJIGV4aXN0cyBmb3IgdGhlIGdpdmVuIG5hbWUgYW5kIHN0YWNrXG4gICAgICAgIGlmICghdGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF0/LlsgbmFtZSBdKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQVBJIG5vdCBmb3VuZDogY29uc3RydWN0IG5hbWUgJHthcGlDb25zdHJ1Y3ROYW1lfSBhbmQgbmFtZSAke25hbWV9YCk7XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmFwaXNbIGFwaUNvbnN0cnVjdE5hbWUgXVsgbmFtZSBdO1xuICAgIH1cblxuICAgIGdldEFQSXMoYXBpQ29uc3RydWN0TmFtZTogc3RyaW5nKTogYW55IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdO1xuICAgIH1cblxuICAgIGhhc0ltcG9ydGVkQVBJKGFwaUNvbnN0cnVjdE5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgICAgICBpZiAoIXRoaXMuYXBpc1sgYXBpQ29uc3RydWN0TmFtZSBdKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiBhbnkgQVBJIGluIGFueSBzdGFjayBpcyBtYXJrZWQgYXMgaW1wb3J0ZWRcbiAgICAgICAgcmV0dXJuIE9iamVjdC52YWx1ZXModGhpcy5hcGlzWyBhcGlDb25zdHJ1Y3ROYW1lIF0pXG4gICAgICAgICAgICAuc29tZShhcGkgPT4gYXBpLmlzSW1wb3J0ZWQgPT09IHRydWUpO1xuICAgIH1cblxuICAgIGFkZE1vZHVsZShuYW1lOiBzdHJpbmcsIG1vZHVsZTogSUZ3MjRNb2R1bGUpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhZGRNb2R1bGU6XCIsIHsgbmFtZSwgbW9kdWxlOiBtb2R1bGUuZ2V0QmFzZVBhdGgoKSB9KTtcblxuICAgICAgICAvLyBjb2xsZWN0IGFsbCBleHBvcnRlZCBwb2xpY2llcyBmcm9tIHRoaXMgbW9kdWxlXG4gICAgICAgIGZvciAoY29uc3QgWyBwb2xpY3lOYW1lLCBwb2xpY3kgXSBvZiBtb2R1bGUuZ2V0RXhwb3J0ZWRQb2xpY2llcygpKSB7XG4gICAgICAgICAgICB0aGlzLnNldFBvbGljeShwb2xpY3lOYW1lLCBwb2xpY3ksIG1vZHVsZS5nZXROYW1lKCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gYWRkIGFsbCBleHBvcnRlZCBzdGF0aWMgZW52IHZhbHVlcyBpbnRvIHRoZSBGVzI0IHNjb3BlXG4gICAgICAgIGZvciAoY29uc3QgWyBlbnZOYW1lLCBlbnZWYWx1ZSBdIG9mIG1vZHVsZS5nZXRFeHBvcnRlZEVudmlyb25tZW50VmFyaWFibGVzKCkpIHtcbiAgICAgICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShlbnZOYW1lLCBlbnZWYWx1ZSwgbW9kdWxlLmdldE5hbWUoKSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLm1vZHVsZXMuc2V0KG5hbWUsIG1vZHVsZSk7XG4gICAgfVxuXG4gICAgZ2V0TW9kdWxlcygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubW9kdWxlc1xuICAgIH1cblxuICAgIGhhc01vZHVsZXMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm1vZHVsZXMuc2l6ZSA+IDA7XG4gICAgfVxuXG4gICAgZ2V0VW5pcXVlTmFtZShuYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIGAke25hbWV9LSR7dGhpcy5jb25maWcubmFtZX0tJHt0aGlzLmNvbmZpZy5lbnZpcm9ubWVudCB8fCAnZW52J30tJHt0aGlzLmNvbmZpZy5hY2NvdW50fWA7XG4gICAgfVxuXG4gICAgZ2V0QXJuKHR5cGU6IHN0cmluZywgbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIGBhcm46YXdzOiR7dHlwZX06JHt0aGlzLmNvbmZpZy5yZWdpb259OiR7dGhpcy5jb25maWcuYWNjb3VudH06JHtuYW1lfWA7XG4gICAgfVxuXG4gICAgc2V0Q29nbml0b0F1dGhvcml6ZXIobmFtZTogc3RyaW5nLCBhdXRob3JpemVyOiBJQXV0aG9yaXplciwgZGVmYXVsdEF1dGhvcml6ZXI6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcInNldENvZ25pdG9BdXRob3JpemVyOiBcIiwgeyBuYW1lLCBhdXRob3JpemVyOiBhdXRob3JpemVyLmF1dGhvcml6ZXJJZCwgZGVmYXVsdEF1dGhvcml6ZXIgfSk7XG5cbiAgICAgICAgdGhpcy5jb2duaXRvQXV0aG9yaXplcnNbIG5hbWUgXSA9IGF1dGhvcml6ZXI7XG4gICAgICAgIC8vIElmIHRoaXMgYXV0aG9yaXplciBpcyB0aGUgZGVmYXVsdCwgc2V0IGl0IGFzIHRoZSBkZWZhdWx0IGF1dGhvcml6ZXJcbiAgICAgICAgaWYgKGRlZmF1bHRBdXRob3JpemVyICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgdGhpcy5kZWZhdWx0QXV0aG9yaXplciA9IGF1dGhvcml6ZXI7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRDb2duaXRvQXV0aG9yaXplcihuYW1lPzogc3RyaW5nKTogSUF1dGhvcml6ZXIgfCB1bmRlZmluZWQge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImdldENvZ25pdG9BdXRob3JpemVyOiBcIiwgeyBuYW1lIH0pO1xuICAgICAgICAvLyBJZiBubyBuYW1lIGlzIHByb3ZpZGVkIGFuZCBubyBkZWZhdWx0IGF1dGhvcml6ZXIgaXMgc2V0LCB0aHJvdyBhbiBlcnJvclxuICAgICAgICBpZiAobmFtZSA9PT0gdW5kZWZpbmVkICYmIHRoaXMuZGVmYXVsdEF1dGhvcml6ZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBBdXRob3JpemVyIGV4aXN0cyBmb3IgY29nbml0byB1c2VyIHBvb2xzLiBGb3IgcG9saWN5IGJhc2VkIGF1dGhlbnRpY2F0aW9uLCB1c2UgQVdTX0lBTSBhdXRob3Jpc2VyLicpO1xuICAgICAgICB9XG4gICAgICAgIC8vIElmIG5vIG5hbWUgaXMgcHJvdmlkZWQsIHJldHVybiB0aGUgZGVmYXVsdCBhdXRob3JpemVyXG4gICAgICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmRlZmF1bHRBdXRob3JpemVyO1xuICAgICAgICB9XG4gICAgICAgIC8vIGlmIGF1dGhvcml6ZXIgd2l0aCBuYW1lIGlzIG5vdCBmb3VuZCwgdGhyb3cgYW4gZXJyb3JcbiAgICAgICAgaWYgKHRoaXMuY29nbml0b0F1dGhvcml6ZXJzWyBuYW1lIF0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdXRob3JpemVyIHdpdGggbmFtZTogJHtuYW1lfSBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBJZiBhIG5hbWUgaXMgcHJvdmlkZWQsIHJldHVybiB0aGUgYXV0aG9yaXplciB3aXRoIHRoYXQgbmFtZVxuICAgICAgICByZXR1cm4gdGhpcy5jb2duaXRvQXV0aG9yaXplcnNbIG5hbWUgXTtcbiAgICB9XG5cbiAgICBnZXRBdXRob3JpemVyKGF1dGhvcml6YXRpb25UeXBlOiBzdHJpbmcsIG5hbWU/OiBzdHJpbmcpOiBJQXV0aG9yaXplciB8IHVuZGVmaW5lZCB7XG4gICAgICAgIGlmIChhdXRob3JpemF0aW9uVHlwZSA9PT0gXCJDT0dOSVRPX1VTRVJfUE9PTFNcIikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0Q29nbml0b0F1dGhvcml6ZXIobmFtZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGF1dGhvcml6YXRpb25UeXBlID09PSBcIkpXVFwiKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRKd3RBdXRob3JpemVyKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBzZXREZWZhdWx0Q29nbml0b0F1dGhvcml6ZXJOYW1lKG5hbWU6IHN0cmluZykge1xuICAgICAgICB0aGlzLnNldEVudmlyb25tZW50VmFyaWFibGUoJ2RlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUnLCBuYW1lLCAnY29nbml0bycpO1xuICAgIH1cblxuICAgIGdldERlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUoJ2RlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUnLCAnY29nbml0bycpO1xuICAgIH1cblxuICAgIHNldEVudmlyb25tZW50VmFyaWFibGUobmFtZTogc3RyaW5nLCB2YWx1ZTogYW55LCBwcmVmaXg6IHN0cmluZyA9ICcnKSB7XG4gICAgICAgIHRoaXMuZW52aXJvbm1lbnRWYXJpYWJsZXNbIGVuc3VyZVZhbGlkRW52S2V5KG5hbWUsIHByZWZpeCkgXSA9IHZhbHVlO1xuICAgIH1cblxuICAgIGdldEVudmlyb25tZW50VmFyaWFibGUobmFtZTogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyA9ICcnLCBzY29wZT86IGFueSk6IGFueSB7XG4gICAgICAgIC8vIGlmIGxvb2t1cCBpcyBmb3IgY29uc3RydWN0IG91dHB1dCAoYmFzZWQgb24gcHJlZml4IGJlaW5nIG9uZSBvZiB0aGUgb3V0cHV0IHR5cGVzKVxuICAgICAgICAvLyBhbmQgdGhlIGFwcGxpY2F0aW9uIGhhcyBtdWx0aXBsZSBzdGFja3MsIHRoZW4gbG9vayBmb3IgdmFsdWUgaW4gdGhlIHN0YWNrIGV4cG9ydFxuICAgICAgICAvLyBpZiB0aGUgc2NvcGUgaXMgZGVmaW5lZCBhbmQgaXMgYSBzdGFjayBhbmQgdGhlIG91dHB1dCBpcyBmcm9tIHRoZSBzYW1lIHN0YWNrLCB0aGVuIHJldHVybiB0aGUgdmFsdWVcblxuICAgICAgICBpZiAocHJlZml4Lmxlbmd0aCA+IDAgJiYgc2NvcGUgJiYgc2NvcGUgaW5zdGFuY2VvZiBTdGFjayAmJiB0aGlzLnVzZU11bHRpU3RhY2tTZXR1cCgpKSB7XG4gICAgICAgICAgICBjb25zdCBpc1ByZWZpeE91dHB1dFR5cGUgPSBPYmplY3QudmFsdWVzKE91dHB1dFR5cGUpLmluY2x1ZGVzKHByZWZpeC5zcGxpdCgnXycpWyAwIF0gYXMgT3V0cHV0VHlwZSk7XG4gICAgICAgICAgICBpZiAoaXNQcmVmaXhPdXRwdXRUeXBlKSB7XG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIFNTTSBwYXJhbWV0ZXIgcmVmZXJlbmNlXG4gICAgICAgICAgICAgICAgLy8gbWFrZSBzdXJlIHRoZSBrZXkgaXMgc3BlY2lmaWVkIGFzIHF1YWxpZmllZCBrZXkgaS5lLiBrZXlfZXhwb3J0VmFsdWVLZXlcbiAgICAgICAgICAgICAgICAvLyBpdCBpcyBwb3NzaWJsZSB0aGF0IHRoZSBrZXkgaXMgbm90IHF1YWxpZmllZCBpZiB0aGUgcHJlZml4IGhhcyBvdXRwdXQgdHlwZSBhbmQga2V5IG5hbWUuIGllLiBwcmVmaXg6IHVzZXJwb29sX2F1dGhtb2R1bGUsIGtleTogdXNlclBvb2xJZFxuICAgICAgICAgICAgICAgIGlmICghbmFtZS5pbmNsdWRlcygnXycpICYmICFwcmVmaXguaW5jbHVkZXMoJ18nKSkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEVudmlyb25tZW50IHZhcmlhYmxlICR7bmFtZX0gaXMgbm90IGEgcXVhbGlmaWVkIGtleS4gUGxlYXNlIHNwZWNpZnkgYXMga2V5X2V4cG9ydFZhbHVlS2V5LiBlLmcuIHJlc3RBUElfcmVzdEFwaUlkYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvbnN0IHNzbUtleSA9IHRoaXMuZW52aXJvbm1lbnRWYXJpYWJsZXNbIGVuc3VyZVZhbGlkRW52S2V5KG5hbWUsIGBTU006JHtwcmVmaXh9YCkgXTtcblxuICAgICAgICAgICAgICAgIGlmIChzc21LZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhY2tOYW1lID0gc3NtS2V5LnNwbGl0KCcvJylbIDEgXTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENoZWNraW5nIGlmIG11bHRpLXN0YWNrIHNldHVwIHNob3VsZCBiZSB1c2VkIGZvciBlbnZpcm9ubWVudCB2YXJpYWJsZTogJHtlbnN1cmVWYWxpZEVudktleShuYW1lLCBwcmVmaXgpfSBpbiBzdGFjazogJHtzdGFja05hbWV9IGNhbGxlZCBmcm9tIHN0YWNrOiAke3Njb3BlLnN0YWNrTmFtZX0gLSAke3RoaXMudXNlTXVsdGlTdGFja1NldHVwKHN0YWNrTmFtZSwgc2NvcGUpfWApO1xuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy51c2VNdWx0aVN0YWNrU2V0dXAoc3RhY2tOYW1lLCBzY29wZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEFkZCBjcm9zcy1zdGFjayBkZXBlbmRlbmN5XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzb3VyY2VTdGFjayA9IHRoaXMuc3RhY2tzWyBzdGFja05hbWUgXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzb3VyY2VTdGFjaykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjb3BlLmFkZERlcGVuZGVuY3koc291cmNlU3RhY2spO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRlZCBkZXBlbmRlbmN5IGZyb20gJHtzY29wZS5zdGFja05hbWV9IHRvICR7c3RhY2tOYW1lfSBmb3IgU1NNIGtleTogJHtzc21LZXl9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBdHRlbXB0aW5nIHRvIGltcG9ydCBTU00gdmFsdWUgZm9yIGtleTogJHtzc21LZXl9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFN0cmluZ1BhcmFtZXRlci52YWx1ZUZvclN0cmluZ1BhcmFtZXRlcihzY29wZSwgc3NtS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gU1NNIGtleSBmb3VuZCBpbiBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIGtleTogJHtlbnN1cmVWYWxpZEVudktleShuYW1lLCBgU1NNOiR7cHJlZml4fWApfSwgdXNpbmcgZGlyZWN0IHJlZmVyZW5jZWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmVudmlyb25tZW50VmFyaWFibGVzWyBlbnN1cmVWYWxpZEVudktleShuYW1lLCBwcmVmaXgpIF07XG4gICAgfVxuXG4gICAgaGFzRW52aXJvbm1lbnRWYXJpYWJsZShuYW1lOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nID0gJycpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIChlbnN1cmVWYWxpZEVudktleShuYW1lLCBwcmVmaXgpIGluIHRoaXMuZW52aXJvbm1lbnRWYXJpYWJsZXMpO1xuICAgIH1cblxuICAgIHJlc29sdmVFbnZWYXJpYWJsZXMgPSAoZW52OiBJTGFtYmRhRW52Q29uZmlnW10gPSBbXSwgc2NvcGU/OiBhbnkpID0+IHtcbiAgICAgICAgY29uc3QgcmVzb2x2ZWQ6IGFueSA9IHt9O1xuICAgICAgICBmb3IgKGNvbnN0IGVudkNvbmZpZyBvZiBlbnYpIHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gZW52Q29uZmlnLnZhbHVlID8/IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShlbnZDb25maWcubmFtZSwgZW52Q29uZmlnLnByZWZpeCwgc2NvcGUpO1xuICAgICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZWRbIGVudkNvbmZpZy5leHBvcnROYW1lID8/IGVudkNvbmZpZy5uYW1lIF0gPSB2YWx1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgRW52aXJvbm1lbnQgdmFyaWFibGUgW3ByZWZpeDogJHtlbnZDb25maWcucHJlZml4fV0gJHtlbnZDb25maWcubmFtZX0gbm90IGZvdW5kIGluIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc29sdmVkO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIHZhbHVlIGZvciB0aGUgZ2l2ZW4gdGVtcGxhdGUgZnJvbSB0aGUgRncyNC1zY29wZSBlbnYgaWYgaXQgZm9sbG93cyB0aGUgY29udmVudGlvbnMgbGlrZSBgZW52Onh4eDp5eXlgLCBgZW52Onl5eWAuXG4gICAgICogXG4gICAgICogQHBhcmFtIGtleVRlbXBsYXRlIC0gVGhlIHRlbXBsYXRlIGZvciB0aGUgZW52aXJvbm1lbnQga2V5IHRvIHJlc29sdmUuXG4gICAgICogIGUuZy4gZW52OlVzZXJzX1RhYmxlX25hbWUsIGVudjp1c2VyTW9kdWxlOlVzZXJzX1RhYmxlX25hbWVcbiAgICAgKiBAcmV0dXJucyBUaGUgcmVzb2x2ZWQgdmFsdWUgZm9yIHRoZSBrZXkuXG4gICAgICovXG4gICAgdHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlID0gKGtleVRlbXBsYXRlOiBzdHJpbmcpID0+IHtcbiAgICAgICAgaWYgKGtleVRlbXBsYXRlLnN0YXJ0c1dpdGgoJ2VudjonKSkge1xuICAgICAgICAgICAgLy8gZW52OnVzZXJNb2R1bGU6VXNlcnNfVGFibGVfbmFtZSA9PiBbJ2VudicsICd1c2VyTW9kdWxlJywgJ1VzZXJzX1RhYmxlX25hbWUnXTtcbiAgICAgICAgICAgIGNvbnN0IHBhcnRzID0ga2V5VGVtcGxhdGUuc3BsaXQoJzonKTtcblxuICAgICAgICAgICAgLy8gZ2V0IHRoZSBhY3R1YWwgdmFsdWUgZnJvbSB0aGUgZncyNCBzY29wZSA9PT4gZncyNC5nZXQoJ1VzZXJzX1RhYmxlX25hbWUnLCAndXNlck1vZHVsZScpO1xuICAgICAgICAgICAga2V5VGVtcGxhdGUgPSBwYXJ0cy5sZW5ndGggPT09IDMgPyB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUocGFydHNbIDIgXSwgcGFydHNbIDEgXSkgOiB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUocGFydHNbIDEgXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGtleVRlbXBsYXRlO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNldCBhIGdsb2JhbCBlbnZpcm9ubWVudCB2YXJpYWJsZS4gVGhpcyB2YXJpYWJsZSB3aWxsIGJlIGF2YWlsYWJsZSB0byBhbGwgbGFtYmRhIGZ1bmN0aW9ucy5cbiAgICAgKiBAcGFyYW0gbmFtZSBUaGUgbmFtZSBvZiB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUuXG4gICAgICogQHBhcmFtIHZhbHVlIFRoZSB2YWx1ZSBvZiB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUuXG4gICAgICovXG4gICAgc2V0R2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZShuYW1lOiBzdHJpbmcsIHZhbHVlOiBhbnkpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJzZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlOlwiLCBuYW1lLCB2YWx1ZSk7XG4gICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShuYW1lLCB2YWx1ZSwgJycpO1xuICAgICAgICB0aGlzLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzLnB1c2goZW5zdXJlVmFsaWRFbnZLZXkobmFtZSwgJycpKTtcbiAgICB9XG5cbiAgICBnZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcygpOiBzdHJpbmdbXSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEFkZCBhIHBvbGljeSBzdGF0ZW1lbnQgdGhhdCBzaG91bGQgYmUgYXR0YWNoZWQgdG8gQUxMIExhbWJkYSBmdW5jdGlvbnMgaW4gdGhlIGFwcGxpY2F0aW9uLlxuICAgICAqIFRoaXMgaXMgdXNlZnVsIGZvciBjcm9zcy1jdXR0aW5nIGNvbmNlcm5zIGxpa2Ugb2JzZXJ2YWJpbGl0eSwgbG9nZ2luZywgb3Igc2hhcmVkIHJlc291cmNlcy5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIC8vIEFkZCBhbiBpbXBvcnRlZCBwb2xpY3kgYnkgbmFtZVxuICAgICAqIGZ3MjQuYWRkR2xvYmFsUG9saWN5KCdteS1wb2xpY3ktbmFtZScpO1xuICAgICAqIGZ3MjQuYWRkR2xvYmFsUG9saWN5KCdteS1wb2xpY3ktbmFtZScsICdteS1wcmVmaXgnKTtcbiAgICAgKiBmdzI0LmFkZEdsb2JhbFBvbGljeSh7IG5hbWU6ICdteS1wb2xpY3ktbmFtZScsIHByZWZpeDogJ215LXByZWZpeCcsIGlzT3B0aW9uYWw6IHRydWUgfSk7XG4gICAgICogXG4gICAgICogLy8gQWRkIGEgZGlyZWN0IHBvbGljeSBzdGF0ZW1lbnRcbiAgICAgKiBmdzI0LmFkZEdsb2JhbFBvbGljeShuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgKiAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAqICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnXSxcbiAgICAgKiAgIHJlc291cmNlczogWycqJ11cbiAgICAgKiB9KSk7XG4gICAgICogXG4gICAgICogLy8gQWRkIHBvbGljeSBzdGF0ZW1lbnQgcHJvcHNcbiAgICAgKiBmdzI0LmFkZEdsb2JhbFBvbGljeSh7XG4gICAgICogICBlZmZlY3Q6IEVmZmVjdC5BTExPVyxcbiAgICAgKiAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0J10sXG4gICAgICogICByZXNvdXJjZXM6IFsnKiddXG4gICAgICogfSk7XG4gICAgICogXG4gICAgICogQHBhcmFtIHBvbGljeSBUaGUgcG9saWN5IHRvIGFkZCAtIGNhbiBiZSBhIG5hbWUgc3RyaW5nLCBUSW1wb3J0ZWRQb2xpY3ksIFBvbGljeVN0YXRlbWVudCwgb3IgUG9saWN5U3RhdGVtZW50UHJvcHNcbiAgICAgKiBAcGFyYW0gcHJlZml4IFRoZSBwcmVmaXggZm9yIGltcG9ydGVkIHBvbGljeSBuYW1lIChvcHRpb25hbCwgb25seSB1c2VkIHdoZW4gcG9saWN5IGlzIGEgc3RyaW5nKVxuICAgICAqIEBwYXJhbSBpc09wdGlvbmFsIFdoZXRoZXIgdGhlIHBvbGljeSBpcyBvcHRpb25hbCAob3B0aW9uYWwsIG9ubHkgdXNlZCB3aGVuIHBvbGljeSBpcyBhIHN0cmluZylcbiAgICAgKi9cbiAgICBhZGRHbG9iYWxQb2xpY3kocG9saWN5OiBzdHJpbmcgfCBUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeSwgcHJlZml4OiBzdHJpbmcgPSAnJywgaXNPcHRpb25hbDogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgICAgIGlmICh0eXBlb2YgcG9saWN5ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgLy8gVHJlYXQgYXMgaW1wb3J0ZWQgcG9saWN5IG5hbWUgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiYWRkR2xvYmFsUG9saWN5IChpbXBvcnRlZCk6XCIsIHsgbmFtZTogcG9saWN5LCBwcmVmaXgsIGlzT3B0aW9uYWwgfSk7XG4gICAgICAgICAgICB0aGlzLmdsb2JhbFBvbGljaWVzLmFkZCh7IG5hbWU6IHBvbGljeSwgcHJlZml4LCBpc09wdGlvbmFsIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRGlyZWN0IHBvbGljeSBzdGF0ZW1lbnQgb3IgUG9saWN5U3RhdGVtZW50UHJvcHMgb3IgVEltcG9ydGVkUG9saWN5XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImFkZEdsb2JhbFBvbGljeSAoZGlyZWN0KTpcIiwgeyBwb2xpY3kgfSk7XG4gICAgICAgICAgICB0aGlzLmdsb2JhbFBvbGljaWVzLmFkZChwb2xpY3kpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGFsbCBnbG9iYWwgcG9saWNpZXMgdGhhdCBzaG91bGQgYmUgYXR0YWNoZWQgdG8gQUxMIExhbWJkYSBmdW5jdGlvbnMuXG4gICAgICogQHJldHVybnMgU2V0IG9mIHBvbGljaWVzIChjYW4gYmUgVFBvbGljeVN0YXRlbWVudE9yUHJvcHMgb3IgVEltcG9ydGVkUG9saWN5KVxuICAgICAqL1xuICAgIGdldEdsb2JhbFBvbGljaWVzKCk6IFNldDxUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5nbG9iYWxQb2xpY2llcztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXQgZ2xvYmFsIHJlc291cmNlIGFjY2VzcyB0aGF0IHNob3VsZCBiZSBhcHBsaWVkIHRvIEFMTCBMYW1iZGEgZnVuY3Rpb25zLlxuICAgICAqIFRoaXMgcmVwbGFjZXMgYW55IGV4aXN0aW5nIGdsb2JhbCByZXNvdXJjZSBhY2Nlc3MgY29uZmlndXJhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGZ3MjQuc2V0R2xvYmFsUmVzb3VyY2VBY2Nlc3Moe1xuICAgICAqICAgdGFibGVzOiBbJ3VzZXJzLXRhYmxlJywgeyBuYW1lOiAnb3JkZXJzLXRhYmxlJywgYWNjZXNzOiBbJ3JlYWQnXSB9XSxcbiAgICAgKiAgIGJ1Y2tldHM6IFsnYXNzZXRzLWJ1Y2tldCddLFxuICAgICAqICAgcXVldWVzOiBbJ25vdGlmaWNhdGlvbnMtcXVldWUnXSxcbiAgICAgKiAgIHRvcGljczogWydldmVudHMtdG9waWMnXVxuICAgICAqIH0pO1xuICAgICAqIFxuICAgICAqIEBwYXJhbSByZXNvdXJjZUFjY2VzcyBUaGUgcmVzb3VyY2UgYWNjZXNzIGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICBzZXRHbG9iYWxSZXNvdXJjZUFjY2VzcyhyZXNvdXJjZUFjY2VzczogSUZ1bmN0aW9uUmVzb3VyY2VBY2Nlc3MpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJzZXRHbG9iYWxSZXNvdXJjZUFjY2VzczpcIiwgcmVzb3VyY2VBY2Nlc3MpO1xuICAgICAgICB0aGlzLmdsb2JhbFJlc291cmNlQWNjZXNzID0gcmVzb3VyY2VBY2Nlc3M7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQWRkIHRvIGdsb2JhbCByZXNvdXJjZSBhY2Nlc3MgY29uZmlndXJhdGlvbi5cbiAgICAgKiBUaGlzIG1lcmdlcyB3aXRoIGV4aXN0aW5nIGdsb2JhbCByZXNvdXJjZSBhY2Nlc3MgY29uZmlndXJhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGZ3MjQuYWRkR2xvYmFsUmVzb3VyY2VBY2Nlc3Moe1xuICAgICAqICAgdGFibGVzOiBbJ3VzZXJzLXRhYmxlJ10sXG4gICAgICogICBidWNrZXRzOiBbJ2Fzc2V0cy1idWNrZXQnXVxuICAgICAqIH0pO1xuICAgICAqIFxuICAgICAqIEBwYXJhbSByZXNvdXJjZUFjY2VzcyBUaGUgcmVzb3VyY2UgYWNjZXNzIHRvIGFkZFxuICAgICAqL1xuICAgIGFkZEdsb2JhbFJlc291cmNlQWNjZXNzKHJlc291cmNlQWNjZXNzOiBQYXJ0aWFsPElGdW5jdGlvblJlc291cmNlQWNjZXNzPikge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImFkZEdsb2JhbFJlc291cmNlQWNjZXNzOlwiLCByZXNvdXJjZUFjY2Vzcyk7XG4gICAgICAgIFxuICAgICAgICBpZiAocmVzb3VyY2VBY2Nlc3MudGFibGVzKSB7XG4gICAgICAgICAgICB0aGlzLmdsb2JhbFJlc291cmNlQWNjZXNzLnRhYmxlcyA9IFtcbiAgICAgICAgICAgICAgICAuLi4odGhpcy5nbG9iYWxSZXNvdXJjZUFjY2Vzcy50YWJsZXMgfHwgW10pLFxuICAgICAgICAgICAgICAgIC4uLnJlc291cmNlQWNjZXNzLnRhYmxlc1xuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHJlc291cmNlQWNjZXNzLmJ1Y2tldHMpIHtcbiAgICAgICAgICAgIHRoaXMuZ2xvYmFsUmVzb3VyY2VBY2Nlc3MuYnVja2V0cyA9IFtcbiAgICAgICAgICAgICAgICAuLi4odGhpcy5nbG9iYWxSZXNvdXJjZUFjY2Vzcy5idWNrZXRzIHx8IFtdKSxcbiAgICAgICAgICAgICAgICAuLi5yZXNvdXJjZUFjY2Vzcy5idWNrZXRzXG4gICAgICAgICAgICBdO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAocmVzb3VyY2VBY2Nlc3MucXVldWVzKSB7XG4gICAgICAgICAgICB0aGlzLmdsb2JhbFJlc291cmNlQWNjZXNzLnF1ZXVlcyA9IFtcbiAgICAgICAgICAgICAgICAuLi4odGhpcy5nbG9iYWxSZXNvdXJjZUFjY2Vzcy5xdWV1ZXMgfHwgW10pLFxuICAgICAgICAgICAgICAgIC4uLnJlc291cmNlQWNjZXNzLnF1ZXVlc1xuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHJlc291cmNlQWNjZXNzLnRvcGljcykge1xuICAgICAgICAgICAgdGhpcy5nbG9iYWxSZXNvdXJjZUFjY2Vzcy50b3BpY3MgPSBbXG4gICAgICAgICAgICAgICAgLi4uKHRoaXMuZ2xvYmFsUmVzb3VyY2VBY2Nlc3MudG9waWNzIHx8IFtdKSxcbiAgICAgICAgICAgICAgICAuLi5yZXNvdXJjZUFjY2Vzcy50b3BpY3NcbiAgICAgICAgICAgIF07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgZ2xvYmFsIHJlc291cmNlIGFjY2VzcyBjb25maWd1cmF0aW9uLlxuICAgICAqIEByZXR1cm5zIFRoZSBnbG9iYWwgcmVzb3VyY2UgYWNjZXNzIGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICBnZXRHbG9iYWxSZXNvdXJjZUFjY2VzcygpOiBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcyB7XG4gICAgICAgIHJldHVybiB0aGlzLmdsb2JhbFJlc291cmNlQWNjZXNzO1xuICAgIH1cblxuICAgIHNldFBvbGljeShwb2xpY3lOYW1lOiBzdHJpbmcsIHZhbHVlOiBQb2xpY3lTdGF0ZW1lbnRQcm9wcyB8IFBvbGljeVN0YXRlbWVudCwgcHJlZml4OiBzdHJpbmcgPSAnJykge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcInNldFBvbGljeTpcIiwgcHJlZml4LCBwb2xpY3lOYW1lLCB2YWx1ZSk7XG4gICAgICAgIGNvbnN0IHBvbGljeUtleSA9IGVuc3VyZVZhbGlkRW52S2V5KHBvbGljeU5hbWUsIHByZWZpeCk7XG4gICAgICAgIGlmICh0aGlzLnBvbGljeVN0YXRlbWVudHMuaGFzKHBvbGljeUtleSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFBvbGljeSAke3BvbGljeU5hbWV9IGFscmVhZHkgZXhpc3RzIGluIGZ3MjQgc2NvcGUuIE92ZXJ3cml0aW5nIHdpdGggbmV3IHBvbGljeS5gKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnBvbGljeVN0YXRlbWVudHMuc2V0KHBvbGljeUtleSwgdmFsdWUpO1xuICAgIH1cblxuICAgIGdldFBvbGljeShwb2xpY3lOYW1lOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nID0gJycpOiBQb2xpY3lTdGF0ZW1lbnRQcm9wcyB8IFBvbGljeVN0YXRlbWVudCB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHJldHVybiB0aGlzLnBvbGljeVN0YXRlbWVudHMuZ2V0KGVuc3VyZVZhbGlkRW52S2V5KHBvbGljeU5hbWUsIHByZWZpeCkpO1xuICAgIH1cblxuICAgIGhhc1BvbGljeShwb2xpY3lOYW1lOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nID0gJycpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucG9saWN5U3RhdGVtZW50cy5oYXMoZW5zdXJlVmFsaWRFbnZLZXkocG9saWN5TmFtZSwgcHJlZml4KSk7XG4gICAgfVxuXG4gICAgLy8gc2V0IHRoZSBvdXRwdXQgb2YgYSBjb25zdHJ1Y3RcbiAgICAvLyBpZiBleHBvcnRWYWx1ZUFsaWFzIGlzIG5vdCBwcm92aWRlZCwgdGhlIGV4cG9ydCB2YWx1ZSBrZXkgd2lsbCBiZSB1c2VkIGFzIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZSBrZXkuIGkuZSB3aGVuIHVzaW5nIGN1c3RvbSByZXNvdXJjZSBsaWtlIENmbklkZW50aXR5UG9vbCBcbiAgICAvLyB0aGUgb3V0cHV0IGlzIHRoZSByZWZlcmVuY2UgdG8gdGhlIGN1c3RvbSByZXNvdXJjZS4gVGhlIHJlZmVyZW5jZSBpcyBub3QgdGhlIHBoeXNpY2FsIGlkIG9mIHRoZSBjdXN0b20gcmVzb3VyY2UsIGJ1dCBhIGxvZ2ljYWwgaWRcbiAgICAvLyB0aGF0IGlzIHJlc29sdmVkIHRvIHRoZSBwaHlzaWNhbCBpZCBhdCBydW50aW1lLiBJbiB0aGlzIGNhc2UsIHRoZSBleHBvcnRWYWx1ZUFsaWFzIGlzIHRoZSBrZXkgbmFtZSBvZiB0aGUgY3VzdG9tIHJlc291cmNlLlxuICAgIHNldENvbnN0cnVjdE91dHB1dChjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QsIGtleTogc3RyaW5nLCB2YWx1ZTogYW55LCBvdXRwdXRUeXBlPzogT3V0cHV0VHlwZSwgZXhwb3J0VmFsdWVLZXk/OiBzdHJpbmcsIGV4cG9ydFZhbHVlQWxpYXM/OiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHNldENvbnN0cnVjdE91dHB1dDogJHtjb25zdHJ1Y3QubmFtZX1gLCB7IG91dHB1dFR5cGUsIGtleSB9KTtcbiAgICAgICAgaWYgKG91dHB1dFR5cGUpIHtcbiAgICAgICAgICAgIGNvbnN0cnVjdC5vdXRwdXQgPSB7XG4gICAgICAgICAgICAgICAgLi4uY29uc3RydWN0Lm91dHB1dCxcbiAgICAgICAgICAgICAgICBbIG91dHB1dFR5cGUgXToge1xuICAgICAgICAgICAgICAgICAgICAuLi5jb25zdHJ1Y3Qub3V0cHV0Py5bIG91dHB1dFR5cGUgXSxcbiAgICAgICAgICAgICAgICAgICAgWyBrZXkgXTogdmFsdWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLnNldEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSwgYCR7Y29uc3RydWN0Lm5hbWV9XyR7b3V0cHV0VHlwZX1gKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBzZXRFbnZpcm9ubWVudFZhcmlhYmxlOiAke2tleX1gLCB7IHByZWZpeDogYCR7Y29uc3RydWN0Lm5hbWV9XyR7b3V0cHV0VHlwZX1gIH0pO1xuXG4gICAgICAgICAgICAvLyBpbiBjYXNlIG9mIG9iamVjdCByZWZlcmVuY2UsIGV4cG9ydCB0aGUgb3V0cHV0IHRvIGJlIHVzZWQgaW4gb3RoZXIgc3RhY2tzXG4gICAgICAgICAgICBsZXQgb3V0cHV0VmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIGV4cG9ydFZhbHVlS2V5KSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0VmFsdWUgPSB2YWx1ZVsgZXhwb3J0VmFsdWVLZXkgXTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiBleHBvcnRWYWx1ZUtleSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDcmVhdGUgQ2xvdWRGb3JtYXRpb24gZXhwb3J0IHdpdGggdmFsaWQgbmFtaW5nXG4gICAgICAgICAgICBjb25zdCBzYW5pdGl6ZWRLZXkgPSBlbnN1cmVWYWxpZEVudktleShrZXksICcnLCAnJywgdHJ1ZSk7XG4gICAgICAgICAgICBjb25zdCBleHBvcnRLZXkgPSBgJHtvdXRwdXRUeXBlfSR7c2FuaXRpemVkS2V5fSR7ZXhwb3J0VmFsdWVBbGlhcyB8fCBleHBvcnRWYWx1ZUtleX1gO1xuICAgICAgICAgICAgY29uc3Qgc3RhY2tFeHBvcnROYW1lID0gYCR7Y29uc3RydWN0Lm1haW5TdGFjay5zdGFja05hbWV9LSR7ZXhwb3J0S2V5fWA7XG5cbiAgICAgICAgICAgIG5ldyBDZm5PdXRwdXQoY29uc3RydWN0Lm1haW5TdGFjaywgZXhwb3J0S2V5LCB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IG91dHB1dFZhbHVlLFxuICAgICAgICAgICAgICAgIGV4cG9ydE5hbWU6IHN0YWNrRXhwb3J0TmFtZSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBzZXQgdGhlIGVudmlyb25tZW50IHZhcmlhYmxlIGZvciB0aGUgZGlyZWN0IHJlZmVyZW5jZVxuICAgICAgICAgICAgdGhpcy5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGAke2tleX1fJHtleHBvcnRWYWx1ZUFsaWFzIHx8IGV4cG9ydFZhbHVlS2V5fWAsIG91dHB1dFZhbHVlLCBvdXRwdXRUeXBlKTtcbiAgICAgICAgICAgIC8vIFN0b3JlIFNTTSBwYXJhbWV0ZXIgZm9yIGNyb3NzLXN0YWNrIHJlZmVyZW5jZVxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYHVzZU11bHRpU3RhY2tTZXR1cDogJHt0aGlzLnVzZU11bHRpU3RhY2tTZXR1cCgpfWApO1xuICAgICAgICAgICAgaWYgKHRoaXMudXNlTXVsdGlTdGFja1NldHVwKCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzc21LZXkgPSBgLyR7Y29uc3RydWN0Lm1haW5TdGFjay5zdGFja05hbWV9LyR7b3V0cHV0VHlwZX0vJHtzYW5pdGl6ZWRLZXl9LyR7ZXhwb3J0VmFsdWVBbGlhcyB8fCBleHBvcnRWYWx1ZUtleX1gO1xuICAgICAgICAgICAgICAgIC8vIHNldCB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUgZm9yIHRoZSBjcm9zcy1zdGFjayByZWZlcmVuY2UgdXNpbmcgU1NNIHBhcmFtZXRlclxuICAgICAgICAgICAgICAgIHRoaXMuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShgJHtrZXl9XyR7ZXhwb3J0VmFsdWVBbGlhcyB8fCBleHBvcnRWYWx1ZUtleX1gLCBzc21LZXksIGBTU006JHtvdXRwdXRUeXBlfWApO1xuICAgICAgICAgICAgICAgIG5ldyBTdHJpbmdQYXJhbWV0ZXIoY29uc3RydWN0Lm1haW5TdGFjaywgYFNTTSR7b3V0cHV0VHlwZX0ke3Nhbml0aXplZEtleX0ke2V4cG9ydFZhbHVlQWxpYXMgfHwgZXhwb3J0VmFsdWVLZXl9YCwge1xuICAgICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJOYW1lOiBzc21LZXksXG4gICAgICAgICAgICAgICAgICAgIHN0cmluZ1ZhbHVlOiBvdXRwdXRWYWx1ZSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3RydWN0Lm91dHB1dCA9IHtcbiAgICAgICAgICAgICAgICAuLi5jb25zdHJ1Y3Qub3V0cHV0LFxuICAgICAgICAgICAgICAgIFsga2V5IF06IHZhbHVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLnNldEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSwgY29uc3RydWN0Lm5hbWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWRkRHluYW1vVGFibGUobmFtZTogc3RyaW5nLCB0YWJsZTogVGFibGVWMikge1xuICAgICAgICBuYW1lID0gZW5zdXJlTm9TcGVjaWFsQ2hhcnMobmFtZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiYWRkRHluYW1vVGFibGU6XCIsIHsgbmFtZSB9KTtcbiAgICAgICAgdGhpcy5keW5hbW9UYWJsZXNbIG5hbWUgXSA9IHRhYmxlO1xuICAgIH1cblxuICAgIGdldER5bmFtb1RhYmxlKG5hbWU6IHN0cmluZyk6IFRhYmxlVjIge1xuICAgICAgICByZXR1cm4gdGhpcy5keW5hbW9UYWJsZXNbIGVuc3VyZU5vU3BlY2lhbENoYXJzKG5hbWUpIF07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0cyBhIHF1ZXVlIHJlZmVyZW5jZSBieSBuYW1lLCBmb2xsb3dpbmcgdGhlIGZyYW1ld29yaydzIHBhdHRlcm4gZm9yIGV4aXN0aW5nIHJlc291cmNlIHJlZmVyZW5jZXMuXG4gICAgICogQHBhcmFtIHF1ZXVlTmFtZSBUaGUgbmFtZSBvZiB0aGUgcXVldWVcbiAgICAgKiBAcGFyYW0gc2NvcGUgT3B0aW9uYWwgc2NvcGUgZm9yIHN0YWNrIHJlc29sdXRpb24gXG4gICAgICogQHBhcmFtIGNvbnN0cnVjdElkIE9wdGlvbmFsIGNvbnN0cnVjdCBJRCBmb3IgdW5pcXVlIG5hbWluZ1xuICAgICAqIEByZXR1cm5zIFF1ZXVlIGluc3RhbmNlIHJlZmVyZW5jZWQgYnkgQVJOXG4gICAgICovXG4gICAgZ2V0UXVldWVCeU5hbWUocXVldWVOYW1lOiBzdHJpbmcsIHNjb3BlPzogYW55LCBjb25zdHJ1Y3RJZD86IHN0cmluZyk6IElRdWV1ZSB7XG4gICAgICAgIGNvbnN0IHF1ZXVlVXJsID0gdGhpcy5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHF1ZXVlTmFtZSArICdfcXVldWVOYW1lJywgJ3F1ZXVlJywgc2NvcGUpO1xuICAgICAgICBjb25zdCBxdWV1ZUFybiA9IHRoaXMuZ2V0QXJuKCdzcXMnLCBxdWV1ZVVybCk7XG4gICAgICAgIGNvbnN0IHVuaXF1ZUlkID0gY29uc3RydWN0SWQgPyBgJHtjb25zdHJ1Y3RJZH0tJHtxdWV1ZU5hbWV9LXF1ZXVlYCA6IGAke3F1ZXVlTmFtZX0tcXVldWVgO1xuICAgICAgICByZXR1cm4gUXVldWUuZnJvbVF1ZXVlQXJuKHNjb3BlID8/IHRoaXMuZ2V0U3RhY2soKSwgdW5pcXVlSWQsIHF1ZXVlQXJuKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXRzIGEgdG9waWMgcmVmZXJlbmNlIGJ5IG5hbWUsIGZvbGxvd2luZyB0aGUgZnJhbWV3b3JrJ3MgcGF0dGVybiBmb3IgZXhpc3RpbmcgcmVzb3VyY2UgcmVmZXJlbmNlcy5cbiAgICAgKiBAcGFyYW0gdG9waWNOYW1lIFRoZSBuYW1lIG9mIHRoZSB0b3BpY1xuICAgICAqIEBwYXJhbSBzY29wZSBPcHRpb25hbCBzY29wZSBmb3Igc3RhY2sgcmVzb2x1dGlvblxuICAgICAqIEBwYXJhbSBjb25zdHJ1Y3RJZCBPcHRpb25hbCBjb25zdHJ1Y3QgSUQgZm9yIHVuaXF1ZSBuYW1pbmcgIFxuICAgICAqIEByZXR1cm5zIFRvcGljIGluc3RhbmNlIHJlZmVyZW5jZWQgYnkgQVJOXG4gICAgICovXG4gICAgZ2V0VG9waWNCeU5hbWUodG9waWNOYW1lOiBzdHJpbmcsIHNjb3BlPzogYW55LCBjb25zdHJ1Y3RJZD86IHN0cmluZyk6IElUb3BpYyB7XG4gICAgICAgIGNvbnN0IHRvcGljQXJuVmFsdWUgPSB0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUodG9waWNOYW1lLCAndG9waWNOYW1lJyk7XG4gICAgICAgIGNvbnN0IHRvcGljQXJuID0gdGhpcy5nZXRBcm4oJ3NucycsIHRvcGljQXJuVmFsdWUpO1xuICAgICAgICBjb25zdCB1bmlxdWVJZCA9IGNvbnN0cnVjdElkID8gYCR7Y29uc3RydWN0SWR9LSR7dG9waWNOYW1lfS10b3BpY2AgOiBgJHt0b3BpY05hbWV9LXRvcGljYDtcbiAgICAgICAgcmV0dXJuIFRvcGljLmZyb21Ub3BpY0FybihzY29wZSA/PyB0aGlzLmdldFN0YWNrKCksIHVuaXF1ZUlkLCB0b3BpY0Fybik7XG4gICAgfVxuXG4gICAgYWRkUm91dGVUb1JvbGVQb2xpY3kocm91dGU6IHN0cmluZywgZ3JvdXBzOiBzdHJpbmdbXSwgcmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgICAgIGlmICghZ3JvdXBzIHx8IGdyb3Vwcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGdyb3VwcyA9IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnR3JvdXBzJywgJ2NvZ25pdG8nKTtcbiAgICAgICAgICAgIGlmICghZ3JvdXBzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gZ3JvdXBzIGRlZmluZWQuIEFkZGluZyByb3V0ZTogJHtyb3V0ZX0gdG8gcm9sZSBwb2xpY3kgZm9yIGRlZmF1bHQgYXV0aGVudGljYXRlZCByb2xlLmApO1xuICAgICAgICAgICAgICAgIGdyb3VwcyA9IFsgJ2RlZmF1bHQnIF07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgbGV0IHJvdXRlQWRkZWRUb0dyb3VwUG9saWN5ID0gZmFsc2U7XG4gICAgICAgIGZvciAoY29uc3QgZ3JvdXBOYW1lIG9mIGdyb3Vwcykge1xuICAgICAgICAgICAgLy8gaWYgcmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyBpcyB0cnVlLCBjaGVjayBpZiB0aGUgcm91dGUgaXMgaW4gdGhlIGdyb3VwIGNvbmZpZ1xuICAgICAgICAgICAgaWYgKHJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgJiYgKCF0aGlzLmdldEVudmlyb25tZW50VmFyaWFibGUoJ1JvdXRlcycsICdjb2duaXRvXycgKyBncm91cE5hbWUpPy5pbmNsdWRlcyhyb3V0ZSkpKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBnZXQgcm9sZVxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhZGRSb3V0ZVRvUm9sZVBvbGljeTpcIiwgeyByb3V0ZSwgZ3JvdXBOYW1lIH0pO1xuICAgICAgICAgICAgY29uc3Qgcm9sZTogUm9sZSA9IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnUm9sZScsICdjb2duaXRvXycgKyBncm91cE5hbWUpO1xuICAgICAgICAgICAgaWYgKCFyb2xlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFJvbGUgbm90IGZvdW5kIGZvciBncm91cDogJHtncm91cE5hbWV9LiBSb2xlIGlzIHJlcXVpcmVkIHRvIGFkZCByb3V0ZTogJHtyb3V0ZX0gdG8gcm9sZSBwb2xpY3kuIFBsZWFzZSBtYWtlIHN1cmUgeW91IGhhdmUgYSBncm91cCBkZWZpbmVkIGluIHlvdXIgY29uZmlnIHdpdGggdGhlIG5hbWU6ICR7Z3JvdXBOYW1lfS5gKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBhZGQgcm9sZSBwb2xpY3kgc3RhdGVtZW50IHRvIGFsbG93IHJvdXRlIGFjY2VzcyBmb3IgZ3JvdXBcbiAgICAgICAgICAgIHJvbGUuYWRkVG9Qb2xpY3kodGhpcy5nZXRSb3V0ZVBvbGljeVN0YXRlbWVudChyb3V0ZSkpO1xuICAgICAgICAgICAgcm91dGVBZGRlZFRvR3JvdXBQb2xpY3kgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghcm91dGVBZGRlZFRvR3JvdXBQb2xpY3kpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBSb3V0ZSAke3JvdXRlfSBub3QgZm91bmQgaW4gYW55IGdyb3VwIGNvbmZpZy4gUGxlYXNlIGFkZCB0aGUgcm91dGUgdG8gYSBncm91cCBjb25maWcgdG8gc2VjdXJlIGFjY2Vzcy5gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldFJvdXRlUG9saWN5U3RhdGVtZW50KHJvdXRlOiBzdHJpbmcpIHtcbiAgICAgICAgLy8gd3JpdGUgdGhlIHBvbGljeSBzdGF0ZW1lbnRcbiAgICAgICAgY29uc3Qgc3RhdGVtZW50ID0gbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBlZmZlY3Q6IEVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgIGFjdGlvbnM6IFsgJ2V4ZWN1dGUtYXBpOkludm9rZScgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogWyBgYXJuOmF3czpleGVjdXRlLWFwaToqOio6Ki8qLyovJHtyb3V0ZX1gIF0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiUm91dGVQb2xpY3lTdGF0ZW1lbnQ6XCIsIHsgcm91dGUgfSk7XG5cbiAgICAgICAgcmV0dXJuIHN0YXRlbWVudDtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0Q29uc3RydWN0T3V0cHV0PFQ+KHR5cGU6IE91dHB1dFR5cGUsIG5hbWU6IHN0cmluZyk6IFQgfCB1bmRlZmluZWQge1xuICAgICAgICAvLyBMb29rIHRocm91Z2ggYWxsIGNvbnN0cnVjdHMgdG8gZmluZCB0aGUgb3V0cHV0XG4gICAgICAgIGZvciAoY29uc3QgY29uc3RydWN0IG9mIHRoaXMuY29uc3RydWN0cy52YWx1ZXMoKSkge1xuICAgICAgICAgICAgaWYgKGNvbnN0cnVjdC5vdXRwdXQ/LlsgdHlwZSBdPy5bIG5hbWUgXSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBjb25zdHJ1Y3Qub3V0cHV0WyB0eXBlIF1bIG5hbWUgXSBhcyBUO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgcHVibGljIGFkZENvbnN0cnVjdChjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QpIHtcbiAgICAgICAgdGhpcy5jb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3QubmFtZSwgY29uc3RydWN0KTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0VnBjKHZwY05hbWU6IHN0cmluZyk6IFZwYyB7XG4gICAgICAgIGNvbnN0IHZwYyA9IHRoaXMuZ2V0Q29uc3RydWN0T3V0cHV0PFZwYz4oT3V0cHV0VHlwZS5WUEMsIHZwY05hbWUpO1xuICAgICAgICBpZiAoIXZwYykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBWUEMgJHt2cGNOYW1lfSBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdnBjO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRIb3N0ZWRab25lKGRvbWFpbk5hbWU6IHN0cmluZyk6IElIb3N0ZWRab25lIHtcbiAgICAgICAgLy8gTG9vayB1cCB0aGUgaG9zdGVkIHpvbmUgYnkgZG9tYWluIG5hbWVcbiAgICAgICAgcmV0dXJuIEhvc3RlZFpvbmUuZnJvbUxvb2t1cCh0aGlzLmFwcCwgYCR7ZG9tYWluTmFtZX0tem9uZWAsIHtcbiAgICAgICAgICAgIGRvbWFpbk5hbWUsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHNldEp3dEF1dGhvcml6ZXIoYXV0aG9yaXplcjogSUF1dGhvcml6ZXIsIGRlZmF1bHRBdXRob3JpemVyOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJzZXRKd3RBdXRob3JpemVyOiBcIiwgeyBhdXRob3JpemVyOiBhdXRob3JpemVyLmF1dGhvcml6ZXJJZCB9KTtcbiAgICAgICAgdGhpcy5qd3RBdXRob3JpemVyID0gYXV0aG9yaXplcjtcbiAgICAgICAgaWYgKGRlZmF1bHRBdXRob3JpemVyKSB7XG4gICAgICAgICAgICB0aGlzLmRlZmF1bHRBdXRob3JpemVyID0gYXV0aG9yaXplcjtcbiAgICAgICAgICAgIHRoaXMuZ2V0Q29uZmlnKCkuZGVmYXVsdEF1dGhvcml6YXRpb25UeXBlID0gJ0pXVCc7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRKd3RBdXRob3JpemVyKCk6IElBdXRob3JpemVyIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuand0QXV0aG9yaXplcjtcbiAgICB9XG5cbiAgICBwdWJsaWMgcmVnaXN0ZXJTeXN0ZW1Db250cm9sbGVyKGNvbnRyb2xsZXI6IFN5c3RlbUNvbnRyb2xsZXJEZWZpbml0aW9uKSB7XG4gICAgICAgIHRoaXMuc3lzdGVtQ29udHJvbGxlcnMuc2V0KGNvbnRyb2xsZXIucGF0aCwgY29udHJvbGxlcik7XG4gICAgfVxuICAgIHB1YmxpYyBoYXNTeXN0ZW1Db250cm9sbGVyKHBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gdGhpcy5zeXN0ZW1Db250cm9sbGVycy5oYXMocGF0aCk7XG4gICAgfVxuICAgIHB1YmxpYyBnZXRTeXN0ZW1Db250cm9sbGVyKHBhdGg6IHN0cmluZyk6IFN5c3RlbUNvbnRyb2xsZXJEZWZpbml0aW9uIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3lzdGVtQ29udHJvbGxlcnMuZ2V0KHBhdGgpO1xuICAgIH1cbiAgICBwdWJsaWMgaGFzU3lzdGVtQ29udHJvbGxlcnMoKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5c3RlbUNvbnRyb2xsZXJzLnNpemUgPiAwO1xuICAgIH1cbiAgICBwdWJsaWMgZ2V0U3lzdGVtQ29udHJvbGxlcnMoKTogU3lzdGVtQ29udHJvbGxlckRlZmluaXRpb25bXSB7XG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKHRoaXMuc3lzdGVtQ29udHJvbGxlcnMudmFsdWVzKCkpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyByZWdpc3RlclN5c3RlbVVJQ29uZmlnKG5hbWU6IHN0cmluZywgY29uZmlnOiBTeXN0ZW1VSVBhZ2VEZWZpbml0aW9uKSB7XG4gICAgICAgIHRoaXMuc3lzdGVtVUlDb25maWdzLnNldChuYW1lLCBjb25maWcpO1xuICAgIH1cbiAgICBwdWJsaWMgaGFzU3lzdGVtVUlDb25maWcobmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5c3RlbVVJQ29uZmlncy5oYXMobmFtZSk7XG4gICAgfVxuICAgIHB1YmxpYyBnZXRTeXN0ZW1VSUNvbmZpZyhuYW1lOiBzdHJpbmcpOiBTeXN0ZW1VSVBhZ2VEZWZpbml0aW9uIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3lzdGVtVUlDb25maWdzLmdldChuYW1lKTtcbiAgICB9XG4gICAgcHVibGljIGdldFN5c3RlbVVJQ29uZmlncygpOiBTeXN0ZW1VSVBhZ2VEZWZpbml0aW9uW10ge1xuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbSh0aGlzLnN5c3RlbVVJQ29uZmlncy52YWx1ZXMoKSk7XG4gICAgfVxuICAgIHB1YmxpYyBoYXNTeXN0ZW1VSUNvbmZpZ3MoKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5c3RlbVVJQ29uZmlncy5zaXplID4gMDtcbiAgICB9XG5cbiAgICBwdWJsaWMgcmVnaXN0ZXJTaW11bGF0ZWRMYW1iZGEoaWQ6IHN0cmluZywgY29uZmlnOiBhbnkpIHtcbiAgICAgICAgdGhpcy5zaW11bGF0ZWRMYW1iZGFzLnNldChpZCwgY29uZmlnKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0U2ltdWxhdGVkTGFtYmRhcygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2ltdWxhdGVkTGFtYmRhcztcbiAgICB9XG59Il19