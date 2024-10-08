import { IAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2';
import { IApplicationConfig } from '../interfaces/config';
import { FW24Construct, OutputType } from '../interfaces/construct';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Helper } from './helper';
import { IQueue, Queue } from 'aws-cdk-lib/aws-sqs';
import { ITopic, Topic } from 'aws-cdk-lib/aws-sns';
import { Role, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { IFw24Module } from './module';
import { createLogger } from '../logging';
import { ILambdaEnvConfig } from '../interfaces';

export class Fw24 {
    readonly logger = createLogger(Fw24.name);
    
    public appName: string = "fw24";
    private config: IApplicationConfig = {};
    public emailProvider: any;
    private stacks: any = {};
    private environmentVariables: any = {};
    private defaultCognitoAuthorizer: IAuthorizer | undefined;
    private cognitoAuthorizers: { [key: string]: IAuthorizer } = {};
    private dynamoTables: { [key: string]: TableV2 } = {};
    private static instance: Fw24;

    private queues = new Map<string, IQueue>();
    private topics = new Map<string, ITopic>();
    private modules = new Map<string, IFw24Module>();

    private constructor() {}

    public static getInstance(): Fw24 {
        if (!Fw24.instance) {
            Fw24.instance = new Fw24();
        }

        return Fw24.instance;
    }

    public setConfig(config: IApplicationConfig) {
        this.logger.debug("setConfig:", config);
        this.config = config;
        // Hydrate the config object with environment variables
        Helper.hydrateConfig(this.config);
        // Set the app name
        this.appName = config.name!;
    }

    public getConfig(): IApplicationConfig {
        return this.config;
    }
    
    public addStack(name: string, stack: any): Fw24 {
        this.logger.debug("addStack:", {name} );
        this.stacks[name] = stack;
        return this;
    }

    public getStack(name: string): any {
        return this.stacks[name];
    }

    public addModule(name: string, module: IFw24Module) {
        this.logger.debug("addModule:", {name, module: module.getBasePath()} );

        this.modules.set(name, module);
    }

    public getModules() {
        return this.modules
    }

    public hasModules() {
        return this.modules.size > 0;
    }

    public getUniqueName(name: string) {
        if(this.stacks['main'] === undefined) {
            throw new Error('Main stack not found');
        }
        return `${name}-${this.config.name}-${this.config.environment || 'env'}-${this.stacks['main'].account}`;
    }

    public getArn(type:string, name: string): string {
        if(this.stacks['main'] === undefined) {
            throw new Error('Main stack not found');
        }
        return `arn:aws:${type}:${this.config.region}:${this.stacks['main'].account}:${name}`;
    }

    public getQueueByName(name: string): IQueue {

        if( !this.queues.has(name) ){
            // get full queue name
            const queueName = this.get(name, 'queueName');
            const queueArn = this.getArn('sqs', queueName);
            const queue = Queue.fromQueueArn(this.stacks['main'], queueName, queueArn);
            this.queues.set(name, queue);            
        }

        return this.queues.get(name)!;
    }

    public setCognitoAuthorizer(name: string, authorizer: IAuthorizer, defaultAuthorizer: boolean = false) {
        this.logger.debug("setCognitoAuthorizer: ", {name, authorizer: authorizer.authorizerId, defaultAuthorizer} );

        this.cognitoAuthorizers[name] = authorizer;
        // If this authorizer is the default, set it as the default authorizer
        if(defaultAuthorizer !== false) {
            this.defaultCognitoAuthorizer = authorizer;
        }
    }

    public getCognitoAuthorizer(name?: string): IAuthorizer | undefined {
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

    public getAuthorizer(authorizationType: string, name?: string): IAuthorizer | undefined {
        if(authorizationType === "COGNITO_USER_POOLS") {
            return this.getCognitoAuthorizer(name);
        }
        return undefined;
    }

    public setDefaultCognitoAuthorizerName(name: string) {
        this.set('defaultCognitoAuthorizerName', name, 'cognito');
    }

    public getDefaultCognitoAuthorizerName() {
        return this.get('defaultCognitoAuthorizerName', 'cognito');
    }

    public set(name: string, value: any, prefix: string = '') {
        this.logger.debug("set:", {prefix, name});
        if(prefix.length > 0) {
            prefix = `${prefix}_`;
        }
        this.environmentVariables[`${prefix}${name}`] = value;
    }

    public get(name: string, prefix: string = ''): any {
        if(prefix.length > 0) {
            prefix = `${prefix}_`;
        }
        return this.environmentVariables[`${prefix}${name}`];
    }

    resolveEnvVariables = (env: ILambdaEnvConfig[] = []) => {
        const resolved: any = {};
        for (const envConfig of env ) {
            const value = envConfig.value ?? this.get(envConfig.name, envConfig.prefix || '');
            if (value) {
                resolved[envConfig.name] = value;
            }
        }
        return resolved;
    }

    public setConstructOutput(construct: FW24Construct, key: string, value: any, outputType?: OutputType) {
        this.logger.debug(`setConstructOutput: ${construct.name}`, {outputType, key});
        if(outputType){
            construct.output = {
                ...construct.output,
                [outputType]: {
                    ...construct.output?.[outputType],
                    [key]: value
                }
            }
            this.set(key, value, `${construct.name}_${outputType}`);
        } else {
            construct.output = {
                ...construct.output,
                [key]: value
            }
            this.set(key, value, construct.name);
        }
    }

    public addDynamoTable(name: string, table: TableV2) {
        this.logger.debug("addDynamoTable:", {name} );
        this.dynamoTables[name] = table;
    }

    public getDynamoTable(name: string): TableV2{
        return this.dynamoTables[name];
    }

    public addRouteToRolePolicy(route: string, groups: string[], requireRouteInGroupConfig: boolean = false) {
        if(!groups || groups.length === 0) {
            groups = this.get('Groups', 'cognito');
            if(!groups) {
                this.logger.warn(`No groups defined. Adding route: ${route} to role policy for default authenticated role.`);
                groups = ['default'];
            }
        }
        let routeAddedToGroupPolicy = false;
        for (const groupName of groups) {
            // if requireRouteInGroupConfig is true, check if the route is in the group config
            if(requireRouteInGroupConfig && (!this.get('Routes', 'cognito_' + groupName) || !this.get('Routes', 'cognito_' + groupName).includes(route))) {
                continue;
            }
            // get role
            this.logger.debug("addRouteToRolePolicy:", {route, groupName});
            const role: Role = this.get('Role', 'cognito_' + groupName);
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

    public getRoutePolicyStatement(route: string) {
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