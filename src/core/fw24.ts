import { IAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement, type PolicyStatementProps, type Role } from 'aws-cdk-lib/aws-iam';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import { IQueue, Queue } from 'aws-cdk-lib/aws-sqs';
import { DIContainer } from '../di';
import { type ILambdaEnvConfig } from '../interfaces';
import { IApplicationConfig } from '../interfaces/config';
import { FW24Construct, OutputType } from '../interfaces/construct';
import { type IDIContainer } from '../interfaces/di';
import { createLogger } from '../logging';
import { Helper } from './helper';
import { type IFw24Module } from './runtime/module';
import { ensureNoSpecialChars, ensureValidEnvKey } from '../utils/keys';
import { App, CfnOutput, Fn, NestedStack, Stack } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { IHostedZone, HostedZone } from 'aws-cdk-lib/aws-route53';

export class Fw24 {
    readonly logger = createLogger(Fw24.name);

    appName: string = "fw24";
    emailProvider: any;

    private config: IApplicationConfig = {};
    private app!: App;
    private stacks: Record<string, Stack> = {};
    private apis: { [ apiConstructName: string ]: { [ name: string ]: any } } = {};
    private environmentVariables: Record<string, any> = {};
    private globalEnvironmentVariables: string[] = [];
    private policyStatements = new Map<string, PolicyStatementProps | PolicyStatement>();
    private defaultAuthorizer: IAuthorizer | undefined;
    private cognitoAuthorizers: { [ key: string ]: IAuthorizer } = {};
    private jwtAuthorizer: IAuthorizer | undefined;
    private dynamoTables: { [ key: string ]: TableV2 } = {};
    private static instance: Fw24;

    private queues = new Map<string, IQueue>();
    private topics = new Map<string, ITopic>();
    private modules = new Map<string, IFw24Module>();
    private constructs = new Map<string, FW24Construct>();

    private readonly globalLambdaLayerNames = new Set<string>();
    private readonly globalLambdaEntryPackages = new Set<string>();

    private constructor() {} // Empty constructor as App is set via setApp()

    static getInstance(): Fw24 {
        if (!Fw24.instance) {
            Fw24.instance = new Fw24();
        }

        return Fw24.instance;
    }

    setApp(app: App) {
        this.app = app;
    }

    getApp(): App {
        return this.app;
    }

    setConfig(config: IApplicationConfig) {
        this.config = config;
        // Hydrate the config object with environment variables
        Helper.hydrateConfig(this.config);
        // Set the app name
        this.appName = config.name!;
    }

    getConfig(): IApplicationConfig {
        return this.config;
    }

    getAppDIContainer(): IDIContainer {
        return this.config.appDIContainer || DIContainer.ROOT;
    }

    getLambdaEntryPackages(): string[] {
        return this.config.lambdaEntryPackages || Array.from(this.globalLambdaEntryPackages);
    }

    addGlobalLambdaEntryPackage(packageName: string) {
        this.globalLambdaEntryPackages.add(packageName);
    }

    hasGlobalLambdaEntryPackage(packageName: string) {
        return this.globalLambdaEntryPackages.has(packageName);
    }

    removeGlobalLambdaEntryPackage(packageName: string) {
        this.globalLambdaEntryPackages.delete(packageName);
    }

    getGlobalLambdaLayerNames() {
        return this.globalLambdaLayerNames;
    }

    addGlobalLambdaLayerNames(layerName: string) {
        this.globalLambdaLayerNames.add(layerName);
    }

    hasGlobalLambdaLayerNames(layerName: string) {
        return this.globalLambdaLayerNames.has(layerName);
    }

    removeGlobalLambdaLayerNames(layerName: string) {
        this.globalLambdaLayerNames.delete(layerName);
    }

    addStack(name: string, stack: any): Fw24 {
        this.logger.debug("addStack:", { name });
        this.stacks[ name ] = stack;
        return this;
    }

    /**
     * Get a stack by name. If the stack does not exist, create it.
     * 
     * @param name - The name of the stack to get.
     * @param parentStackName - The name of the parent stack.
     * @returns The stack.
     */
    getStack(name?: string, parentStackName?: string): any {
        let stackName: string = name ? name : this.getDefaultStackName();
        // don't allow nested stacks if multiStack is true, multistack is used for creating independent stacks
        if (this.config.multiStack && parentStackName) {
            throw new Error('Nested stacks are not allowed when multiStack is true. Please use multiStack: false or remove the parentStackName parameter.');
        }
        // if the stack does not exist and multiStack is false and parentStackName is not provided, then use the default stack name
        if (this.stacks[ stackName ] === undefined && !(this.config.multiStack || parentStackName)) {
            stackName = this.getDefaultStackName();
        }
        this.logger.debug("Getting Stack With Name:", { stackName });
        if (this.stacks[ stackName ] === undefined) {
            if (parentStackName) {
                // create a new nested stack
                this.stacks[ stackName ] = new NestedStack(this.getStack(parentStackName), stackName);
                this.logger.debug("Created nested stack:", { stackName, parentStackName });
            } else {
                let stackID = `${this.appName}-${stackName}-stack`;
                // backwards compatibility for old stack names
                if (stackName === 'premultistack') {
                    stackID = `${this.appName}-stack`;
                }
                // create a new stack
                this.stacks[ stackName ] = new Stack(this.app, stackID, {
                    env: {
                        account: this.config.account,
                        region: this.config.region
                    }
                });
                // make all stacks dependent on the layer stack
                const layerStack = this.getStack(this.config.layerStackName);
                if (layerStack) {
                    this.stacks[ stackName ].addDependency(layerStack);
                }
                this.logger.debug("Created stack:", { stackName });
            }
        }
        return this.stacks[ stackName ];
    }

    getDefaultStackName(): string {
        return this.config.defaultStackName || 'main';
    }

    useMultiStackSetup = (currentStackName?: string, resourceStack?: Stack): boolean => {
        return (
            this.getConfig().multiStack
            && this.getConfig().multiStack === true
            && (
                // if resource stack is not provided, then only check if multi-stack is enabled
                !resourceStack ||
                // if resource stack is provided, then check if it is a different stack than the current stack
                !(resourceStack?.stackName.endsWith(currentStackName + '-stack') || resourceStack?.stackName === currentStackName)
            )
        ) || false;
    }

    addAPI(apiConstructName: string, name: string, api: any, isImported: boolean = false): Fw24 {
        // Initialize the apiConstructName object if it doesn't exist
        if (!this.apis[ apiConstructName ]) {
            this.apis[ apiConstructName ] = {};
        }
        this.logger.debug("addAPI:", { name });
        this.apis[ apiConstructName ][ name ] = { api: api, isImported: isImported };
        return this;
    }

    getAPI(apiConstructName: string, name: string): any {
        // Check if API exists for the given name and stack
        if (!this.apis[ apiConstructName ] || !this.apis[ apiConstructName ][ name ]) {
            this.logger.debug(`API not found: construct name ${apiConstructName} and name ${name}`);
            return undefined;
        }
        return this.apis[ apiConstructName ][ name ];
    }

    getAPIs(apiConstructName: string): any {
        return this.apis[ apiConstructName ];
    }

    hasImportedAPI(apiConstructName: string): boolean {
        if (!this.apis[ apiConstructName ]) {
            return false;
        }

        // Check if any API in any stack is marked as imported
        return Object.values(this.apis[ apiConstructName ])
            .some(api => api.isImported === true);
    }

    addModule(name: string, module: IFw24Module) {
        this.logger.debug("addModule:", { name, module: module.getBasePath() });

        // collect all exported policies from this module
        for (const [ policyName, policy ] of module.getExportedPolicies()) {
            this.setPolicy(policyName, policy, module.getName());
        }

        // add all exported static env values into the FW24 scope
        for (const [ envName, envValue ] of module.getExportedEnvironmentVariables()) {
            this.setEnvironmentVariable(envName, envValue, module.getName());
        }

        this.modules.set(name, module);
    }

    getModules() {
        return this.modules
    }

    hasModules() {
        return this.modules.size > 0;
    }

    getUniqueName(name: string) {
        return `${name}-${this.config.name}-${this.config.environment || 'env'}-${this.config.account}`;
    }

    getArn(type: string, name: string): string {
        return `arn:aws:${type}:${this.config.region}:${this.config.account}:${name}`;
    }

    setCognitoAuthorizer(name: string, authorizer: IAuthorizer, defaultAuthorizer: boolean = false) {
        this.logger.debug("setCognitoAuthorizer: ", { name, authorizer: authorizer.authorizerId, defaultAuthorizer });

        this.cognitoAuthorizers[ name ] = authorizer;
        // If this authorizer is the default, set it as the default authorizer
        if (defaultAuthorizer !== false) {
            this.defaultAuthorizer = authorizer;
        }
    }

    getCognitoAuthorizer(name?: string): IAuthorizer | undefined {
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
        if (this.cognitoAuthorizers[ name ] === undefined) {
            throw new Error(`Authorizer with name: ${name} not found`);
        }
        // If a name is provided, return the authorizer with that name
        return this.cognitoAuthorizers[ name ];
    }

    getAuthorizer(authorizationType: string, name?: string): IAuthorizer | undefined {
        if (authorizationType === "COGNITO_USER_POOLS") {
            return this.getCognitoAuthorizer(name);
        }
        if (authorizationType === "JWT") {
            return this.getJwtAuthorizer();
        }
        return undefined;
    }

    setDefaultCognitoAuthorizerName(name: string) {
        this.setEnvironmentVariable('defaultCognitoAuthorizerName', name, 'cognito');
    }

    getDefaultCognitoAuthorizerName() {
        return this.getEnvironmentVariable('defaultCognitoAuthorizerName', 'cognito');
    }

    setEnvironmentVariable(name: string, value: any, prefix: string = '') {
        this.environmentVariables[ ensureValidEnvKey(name, prefix) ] = value;
    }

    getEnvironmentVariable(name: string, prefix: string = '', scope?: any): any {
        // if lookup is for construct output (based on prefix being one of the output types)
        // and the application has multiple stacks, then look for value in the stack export
        // if the scope is defined and is a stack and the output is from the same stack, then return the value

        if (prefix.length > 0 && scope && scope instanceof Stack && this.useMultiStackSetup()) {
            const isPrefixOutputType = Object.values(OutputType).includes(prefix.split('_')[ 0 ] as OutputType);
            if (isPrefixOutputType) {
                // Check for SSM parameter reference
                // make sure the key is specified as qualified key i.e. key_exportValueKey
                // it is possible that the key is not qualified if the prefix has output type and key name. ie. prefix: userpool_authmodule, key: userPoolId
                if (!name.includes('_') && !prefix.includes('_')) {
                    throw new Error(`Environment variable ${name} is not a qualified key. Please specify as key_exportValueKey. e.g. restAPI_restApiId`);
                }
                const ssmKey = this.environmentVariables[ ensureValidEnvKey(name, `SSM:${prefix}`) ];

                if (ssmKey) {
                    const stackName = ssmKey.split('/')[ 1 ];
                    this.logger.debug(`Checking if multi-stack setup should be used for environment variable: ${ensureValidEnvKey(name, prefix)} in stack: ${stackName} called from stack: ${scope.stackName} - ${this.useMultiStackSetup(stackName, scope)}`);
                    if (this.useMultiStackSetup(stackName, scope)) {
                        // Add cross-stack dependency
                        const sourceStack = this.stacks[ stackName ];
                        if (sourceStack) {
                            scope.addDependency(sourceStack);
                            this.logger.debug(`Added dependency from ${scope.stackName} to ${stackName} for SSM key: ${ssmKey}`);
                        }
                        try {
                            this.logger.debug(`Attempting to import SSM value for key: ${ssmKey}`);
                            return StringParameter.valueForStringParameter(scope, ssmKey);
                        } catch (error) {
                            this.logger.error(error);
                        }
                    }
                } else {
                    this.logger.warn(`No SSM key found in environment variables for key: ${ensureValidEnvKey(name, `SSM:${prefix}`)}, using direct reference`);
                }
            }
        }

        return this.environmentVariables[ ensureValidEnvKey(name, prefix) ];
    }

    hasEnvironmentVariable(name: string, prefix: string = ''): boolean {
        return (ensureValidEnvKey(name, prefix) in this.environmentVariables);
    }

    resolveEnvVariables = (env: ILambdaEnvConfig[] = [], scope?: any) => {
        const resolved: any = {};
        for (const envConfig of env) {
            const value = envConfig.value ?? this.getEnvironmentVariable(envConfig.name, envConfig.prefix, scope);
            if (value) {
                resolved[ envConfig.exportName ?? envConfig.name ] = value;
            } else {
                this.logger.warn(`Environment variable [prefix: ${envConfig.prefix}] ${envConfig.name} not found in the environment variables.`);
            }
        }
        return resolved;
    }


    /**
     * Resolves the value for the given template from the Fw24-scope env if it follows the conventions like `env:xxx:yyy`, `env:yyy`.
     * 
     * @param keyTemplate - The template for the environment key to resolve.
     *  e.g. env:Users_Table_name, env:userModule:Users_Table_name
     * @returns The resolved value for the key.
     */
    tryResolveEnvKeyTemplate = (keyTemplate: string) => {
        if (keyTemplate.startsWith('env:')) {
            // env:userModule:Users_Table_name => ['env', 'userModule', 'Users_Table_name'];
            const parts = keyTemplate.split(':');

            // get the actual value from the fw24 scope ==> fw24.get('Users_Table_name', 'userModule');
            keyTemplate = parts.length === 3 ? this.getEnvironmentVariable(parts[ 2 ], parts[ 1 ]) : this.getEnvironmentVariable(parts[ 1 ]);
        }
        return keyTemplate;
    }

    /**
     * Set a global environment variable. This variable will be available to all lambda functions.
     * @param name The name of the environment variable.
     * @param value The value of the environment variable.
     */
    setGlobalEnvironmentVariable(name: string, value: any) {
        this.logger.debug("setGlobalEnvironmentVariable:", name, value);
        this.setEnvironmentVariable(name, value, '');
        this.globalEnvironmentVariables.push(ensureValidEnvKey(name, ''));
    }

    getGlobalEnvironmentVariables(): string[] {
        return this.globalEnvironmentVariables;
    }

    setPolicy(policyName: string, value: PolicyStatementProps | PolicyStatement, prefix: string = '') {
        this.logger.debug("setPolicy:", prefix, policyName, value);
        this.policyStatements.set(ensureValidEnvKey(policyName, prefix), value);
    }

    getPolicy(policyName: string, prefix: string = ''): PolicyStatementProps | PolicyStatement | undefined {
        return this.policyStatements.get(ensureValidEnvKey(policyName, prefix));
    }

    hasPolicy(policyName: string, prefix: string = ''): boolean {
        return this.policyStatements.has(ensureValidEnvKey(policyName, prefix));
    }

    // set the output of a construct
    // if exportValueAlias is not provided, the export value key will be used as the environment variable key. i.e when using custom resource like CfnIdentityPool 
    // the output is the reference to the custom resource. The reference is not the physical id of the custom resource, but a logical id
    // that is resolved to the physical id at runtime. In this case, the exportValueAlias is the key name of the custom resource.
    setConstructOutput(construct: FW24Construct, key: string, value: any, outputType?: OutputType, exportValueKey?: string, exportValueAlias?: string) {
        this.logger.debug(`setConstructOutput: ${construct.name}`, { outputType, key });
        if (outputType) {
            construct.output = {
                ...construct.output,
                [ outputType ]: {
                    ...construct.output?.[ outputType ],
                    [ key ]: value
                }
            }
            this.setEnvironmentVariable(key, value, `${construct.name}_${outputType}`);
            this.logger.debug(`setEnvironmentVariable: ${key}`, { prefix: `${construct.name}_${outputType}` });

            // in case of object reference, export the output to be used in other stacks
            let outputValue = value;
            if (typeof value === 'object' && exportValueKey) {
                outputValue = value[ exportValueKey ];
            } else if (typeof value === 'object' && exportValueKey === undefined) {
                return;
            } else if (typeof value !== 'object') {
                return;
            }

            // Create CloudFormation export with valid naming
            const sanitizedKey = ensureValidEnvKey(key, '', '', true);
            const exportKey = `${outputType}${sanitizedKey}${exportValueAlias || exportValueKey}`;
            const stackExportName = `${construct.mainStack.stackName}-${exportKey}`;

            new CfnOutput(construct.mainStack, exportKey, {
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
                new StringParameter(construct.mainStack, `SSM${outputType}${sanitizedKey}${exportValueAlias || exportValueKey}`, {
                    parameterName: ssmKey,
                    stringValue: outputValue,
                });
            }

        } else {
            construct.output = {
                ...construct.output,
                [ key ]: value
            }
            this.setEnvironmentVariable(key, value, construct.name);
        }
    }

    addDynamoTable(name: string, table: TableV2) {
        name = ensureNoSpecialChars(name);
        this.logger.debug("addDynamoTable:", { name });
        this.dynamoTables[ name ] = table;
    }

    getDynamoTable(name: string): TableV2 {
        return this.dynamoTables[ ensureNoSpecialChars(name) ];
    }

    addRouteToRolePolicy(route: string, groups: string[], requireRouteInGroupConfig: boolean = false) {
        if (!groups || groups.length === 0) {
            groups = this.getEnvironmentVariable('Groups', 'cognito');
            if (!groups) {
                this.logger.warn(`No groups defined. Adding route: ${route} to role policy for default authenticated role.`);
                groups = [ 'default' ];
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
            const role: Role = this.getEnvironmentVariable('Role', 'cognito_' + groupName);
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

    getRoutePolicyStatement(route: string) {
        // write the policy statement
        const statement = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [ 'execute-api:Invoke' ],
            resources: [ `arn:aws:execute-api:*:*:*/*/*/${route}` ],
        });

        this.logger.debug("RoutePolicyStatement:", { route });

        return statement;
    }

    public getConstructOutput<T>(type: OutputType, name: string): T | undefined {
        // Look through all constructs to find the output
        for (const construct of this.constructs.values()) {
            if (construct.output?.[type]?.[name]) {
                return construct.output[type][name] as T;
            }
        }
        return undefined;
    }

    public addConstruct(construct: FW24Construct) {
        this.constructs.set(construct.name, construct);
    }

    public getVpc(vpcName: string): Vpc {
        const vpc = this.getConstructOutput<Vpc>(OutputType.VPC, vpcName);
        if (!vpc) {
            throw new Error(`VPC ${vpcName} not found`);
        }
        return vpc;
    }

    public getHostedZone(domainName: string): IHostedZone {
        // Look up the hosted zone by domain name
        return HostedZone.fromLookup(this.app, `${domainName}-zone`, {
            domainName,
        });
    }

    setJwtAuthorizer(authorizer: IAuthorizer, defaultAuthorizer: boolean = false) {
        this.logger.debug("setJwtAuthorizer: ", { authorizer: authorizer.authorizerId });
        this.jwtAuthorizer = authorizer;
        if (defaultAuthorizer) {
            this.defaultAuthorizer = authorizer;
            this.getConfig().defaultAuthorizationType = 'JWT';
        }
    }

    getJwtAuthorizer(): IAuthorizer | undefined {
        return this.jwtAuthorizer;
    }

}