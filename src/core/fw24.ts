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
import { App, CfnOutput, Fn, Stack } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

export class Fw24 {
    readonly logger = createLogger(Fw24.name);
    
    appName: string = "fw24";
    emailProvider: any;
    
    private config: IApplicationConfig = {};
    private app: any;
    private stacks: any = {};
    private apis: any = {};
    private environmentVariables: Record<string, any> = {};
    private policyStatements =  new Map<string, PolicyStatementProps | PolicyStatement>();
    private defaultCognitoAuthorizer: IAuthorizer | undefined;
    private cognitoAuthorizers: { [key: string]: IAuthorizer } = {};
    private dynamoTables: { [key: string]: TableV2 } = {};
    private static instance: Fw24;

    private queues = new Map<string, IQueue>();
    private topics = new Map<string, ITopic>();
    private modules = new Map<string, IFw24Module>();

    private readonly globalLambdaLayerNames = new Set<string>();
    private readonly globalLambdaEntryPackages = new Set<string>();

    private constructor() {}

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
        this.logger.debug("setConfig:", config);
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

    addGlobalLambdaEntryPackage(packageName: string){
        this.globalLambdaEntryPackages.add(packageName);
    }

    hasGlobalLambdaEntryPackage(packageName: string){
        return this.globalLambdaEntryPackages.has(packageName);
    }

    removeGlobalLambdaEntryPackage(packageName: string){
        this.globalLambdaEntryPackages.delete(packageName);
    }

    getGlobalLambdaLayerNames(){
        return this.globalLambdaLayerNames;
    }

    addGlobalLambdaLayerNames(layerName: string){
        this.globalLambdaLayerNames.add(layerName);
    }

    hasGlobalLambdaLayerNames(layerName: string){
        return this.globalLambdaLayerNames.has(layerName);
    }

    removeGlobalLambdaLayerNames(layerName: string){
        this.globalLambdaLayerNames.delete(layerName);
    }

    addStack(name: string, stack: any): Fw24 {
        this.logger.debug("addStack:", {name} );
        this.stacks[name] = stack;
        return this;
    }

    getStack(name: string): any {
        return this.stacks[name];
    }

    addAPI(name: string, api: any): Fw24 {
        this.logger.debug("addAPI:", {name} );
        this.apis[name] = api;
        return this;
    }

    getAPI(name: string): any {
        return this.apis[name];
    }

    addModule(name: string, module: IFw24Module) {
        this.logger.debug("addModule:", {name, module: module.getBasePath()} );

        // collect all exported policies from this module
        for(const [policyName, policy] of module.getExportedPolicies() ){
            this.setPolicy(policyName, policy, module.getName());
        }

        // add all exported static env values into the FW24 scope
        for( const [envName, envValue] of module.getExportedEnvironmentVariables() ){
            this.setEnvironmentVariable( envName, envValue, module.getName() );
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
        if(this.stacks['main'] === undefined) {
            throw new Error('Main stack not found');
        }
        return `${name}-${this.config.name}-${this.config.environment || 'env'}-${this.stacks['main'].account}`;
    }

    getArn(type:string, name: string): string {
        if(this.stacks['main'] === undefined) {
            throw new Error('Main stack not found');
        }
        return `arn:aws:${type}:${this.config.region}:${this.stacks['main'].account}:${name}`;
    }

    setCognitoAuthorizer(name: string, authorizer: IAuthorizer, defaultAuthorizer: boolean = false) {
        this.logger.debug("setCognitoAuthorizer: ", {name, authorizer: authorizer.authorizerId, defaultAuthorizer} );

        this.cognitoAuthorizers[name] = authorizer;
        // If this authorizer is the default, set it as the default authorizer
        if(defaultAuthorizer !== false) {
            this.defaultCognitoAuthorizer = authorizer;
        }
    }

    getCognitoAuthorizer(name?: string): IAuthorizer | undefined {
        this.logger.info("getCognitoAuthorizer: ", {name});
        // If no name is provided and no default authorizer is set, throw an error
        if(name === undefined && this.defaultCognitoAuthorizer === undefined) {
            throw new Error('No Authorizer exists for cognito user pools. For policy based authentication, use AWS_IAM authoriser.');
        }
        // If no name is provided, return the default authorizer
        if(name === undefined) {
            return this.defaultCognitoAuthorizer;
        }
        // if authorizer with name is not found, throw an error
        if(this.cognitoAuthorizers[name] === undefined) {
            throw new Error(`Authorizer with name: ${name} not found`);
        }
        // If a name is provided, return the authorizer with that name
        return this.cognitoAuthorizers[name];
    }

    getAuthorizer(authorizationType: string, name?: string): IAuthorizer | undefined {
        if(authorizationType === "COGNITO_USER_POOLS") {
            return this.getCognitoAuthorizer(name);
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
        this.environmentVariables[ensureValidEnvKey(name, prefix)] = value;
    }

    getEnvironmentVariable(name: string, prefix: string = '', scope?: any): any {
        // if lookup is for construct output (based on prefix being one of the output types)
        // and the application has multiple stacks, then look for value in the stack export
        // if the scope is defined and is a stack and the output is from the same stack, then return the value
        
        if(prefix && this.config.stackNames && this.config.stackNames.length > 1){
            const isPrefixOutputType = Object.values(OutputType).includes(prefix as OutputType);
            if(isPrefixOutputType){
                // Check for SSM parameter reference
                const ssmKey = this.environmentVariables[ensureValidEnvKey(name, `SSM:${prefix}`)];
                if(ssmKey){
                    const stackName = ssmKey.split('/')[1];
                    
                    // Use direct reference if in same stack
                    if(scope && scope instanceof Stack && scope.stackName === stackName){
                        this.logger.debug(`Using direct value for key: ${ssmKey} in same stack`);
                        return this.environmentVariables[ensureValidEnvKey(name, prefix)];
                    }

                    // Add cross-stack dependency
                    if(scope && scope instanceof Stack){
                        const sourceStack = this.stacks[stackName];
                        if(sourceStack){
                            scope.addDependency(sourceStack);
                            this.logger.debug(`Added dependency from ${scope.stackName} to ${stackName} for SSM key: ${ssmKey}`);
                        }
                    }

                    try {
                        this.logger.debug(`Attempting to import SSM value for key: ${ssmKey}`);
                        return StringParameter.valueForStringParameter(scope, ssmKey);
                    } catch (error) {
                        this.logger.error(error);
                        this.logger.warn(`SSM parameter ${ssmKey} not found during build - this is expected during first deployment`);
                        return this.environmentVariables[ensureValidEnvKey(name, prefix)];
                    }
                }
            }
        }

        return this.environmentVariables[ensureValidEnvKey(name, prefix)];
    }

    hasEnvironmentVariable(name: string, prefix: string = ''): boolean{
        return ( ensureValidEnvKey(name, prefix) in this.environmentVariables);
    }

    resolveEnvVariables = (env: ILambdaEnvConfig[] = []) => {
        const resolved: any = {};
        for (const envConfig of env ) {
            const value = envConfig.value ?? this.getEnvironmentVariable(envConfig.name, envConfig.prefix);
            if (value) {
                resolved[envConfig.exportName ?? envConfig.name] = value;
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
      if(keyTemplate.startsWith('env:')){
        // env:userModule:Users_Table_name => ['env', 'userModule', 'Users_Table_name'];
        const parts = keyTemplate.split(':'); 
        
        // get the actual value from the fw24 scope ==> fw24.get('Users_Table_name', 'userModule');
        keyTemplate = parts.length === 3 ? this.getEnvironmentVariable(parts[2], parts[1]) : this.getEnvironmentVariable(parts[1]);
      }
      return keyTemplate;
    }

    setPolicy(policyName: string, value: PolicyStatementProps | PolicyStatement, prefix: string = '') {
        this.logger.debug("setPolicy:", prefix, policyName, value);
        this.policyStatements.set(ensureValidEnvKey(policyName, prefix), value);
    }

    getPolicy(policyName: string, prefix: string = ''): PolicyStatementProps | PolicyStatement | undefined {
        return this.policyStatements.get(ensureValidEnvKey(policyName, prefix));
    }

    hasPolicy(policyName: string, prefix: string = ''): boolean{
        return this.policyStatements.has(ensureValidEnvKey(policyName, prefix));
    }
    
    setConstructOutput(construct: FW24Construct, key: string, value: any, outputType?: OutputType, exportValueKey?: string) {
        this.logger.debug(`setConstructOutput: ${construct.name}`, {outputType, key});
        if(outputType){
            construct.output = {
                ...construct.output,
                [outputType]: {
                    ...construct.output?.[outputType],
                    [key]: value
                }
            }
            this.setEnvironmentVariable(key, value, `${construct.name}_${outputType}`);

            // in case of object reference, export the output to be used in other stacks
            let outputValue = value;
            if(typeof value === 'object' && exportValueKey){
                outputValue = value[exportValueKey];
            } else if(typeof value === 'object' && exportValueKey === undefined){
                return;
            }

            // Create CloudFormation export with valid naming
            const sanitizedKey = ensureValidEnvKey(key, '', '', true);
            const exportKey = `${outputType}${sanitizedKey}`;
            const stackExportName = `${construct.mainStack.stackName}-${exportKey}`;

            this.setEnvironmentVariable(key, `${construct.mainStack.stackName}:${exportKey}`, `ExportOutput:${construct.name}_${outputType}`);
            // keep without construct name as well for backward compatibility
            this.setEnvironmentVariable(key, `${construct.mainStack.stackName}:${exportKey}`, `ExportOutput:${outputType}`);
            
            new CfnOutput(construct.mainStack, exportKey, {
                value: outputValue,
                exportName: stackExportName,
            });

            // Store SSM parameter for cross-stack reference
            const ssmKey = `/${construct.mainStack.stackName}/${outputType}/${sanitizedKey}/${exportValueKey}`;
            this.setEnvironmentVariable(key, ssmKey, `SSM:${outputType}`);
            new StringParameter(construct.mainStack, `SSM${outputType}${sanitizedKey}`, {
                parameterName: ssmKey,
                stringValue: outputValue,
            });

        } else {
            construct.output = {
                ...construct.output,
                [key]: value
            }
            this.setEnvironmentVariable(key, value, construct.name);
        }
    }

    addDynamoTable(name: string, table: TableV2) {
        name = ensureNoSpecialChars(name);
        this.logger.debug("addDynamoTable:", {name} );
        this.dynamoTables[name] = table;
    }

    getDynamoTable(name: string): TableV2{
        return this.dynamoTables[ensureNoSpecialChars(name)];
    }

    addRouteToRolePolicy(route: string, groups: string[], requireRouteInGroupConfig: boolean = false) {
        if(!groups || groups.length === 0) {
            groups = this.getEnvironmentVariable('Groups', 'cognito');
            if(!groups) {
                this.logger.warn(`No groups defined. Adding route: ${route} to role policy for default authenticated role.`);
                groups = ['default'];
            }
        }
        let routeAddedToGroupPolicy = false;
        for (const groupName of groups) {
            // if requireRouteInGroupConfig is true, check if the route is in the group config
            if(requireRouteInGroupConfig && (!this.getEnvironmentVariable('Routes', 'cognito_' + groupName) || !this.getEnvironmentVariable('Routes', 'cognito_' + groupName).includes(route))) {
                continue;
            }
            // get role
            this.logger.debug("addRouteToRolePolicy:", {route, groupName});
            const role: Role = this.getEnvironmentVariable('Role', 'cognito_' + groupName);
            if(!role) {
                this.logger.error(`Role not found for group: ${groupName}. Role is required to add route: ${route} to role policy. Please make sure you have a group defined in your config with the name: ${groupName}.`);
                return;
            }
            // add role policy statement to allow route access for group
            role.addToPolicy(this.getRoutePolicyStatement(route));
            routeAddedToGroupPolicy = true;
        }
        if(!routeAddedToGroupPolicy) {
            this.logger.error(`Route ${route} not found in any group config. Please add the route to a group config to secure access.`);
        }
    }

    getRoutePolicyStatement(route: string) {
        // write the policy statement
        const statement = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['execute-api:Invoke'],
            resources: [`arn:aws:execute-api:*:*:*/*/*/${route}`],
        });

        this.logger.debug("RoutePolicyStatement:", {route, statement});

        return statement;
    }

}