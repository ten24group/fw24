import { IAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2';
import { IApplicationConfig } from '../interfaces/config';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Helper } from './helper';
import { IQueue, Queue } from 'aws-cdk-lib/aws-sqs';

export class Fw24 {
    public appName: string = "fw24";
    private config: IApplicationConfig = {};
    public emailProvider: any;
    private stacks: any = {};
    private environment: any = {};
    private defaultCognitoAuthorizer: IAuthorizer | undefined;
    private cognitoAuthorizers: { [key: string]: IAuthorizer } = {};
    private dynamoTables: { [key: string]: TableV2 } = {};
    private static instance: Fw24;

    private queues = new Map<string, IQueue>();

    private constructor() {}

    public static getInstance(): Fw24 {
        if (!Fw24.instance) {
            Fw24.instance = new Fw24();
        }

        return Fw24.instance;
    }

    public setConfig(config: IApplicationConfig) {
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
        this.stacks[name] = stack;
        return this;
    }

    public getStack(name: string): any {
        return this.stacks[name];
    }

    public getLayerARN(): string {
        if(this.stacks['main'] === undefined) {
            throw new Error('Main stack not found');
        }
        return `arn:aws:lambda:${this.config.region}:${this.stacks['main'].account}:layer:Fw24CoreLayer:${this.config.coreVersion}`;
    }

    public getUniqueName(name: string) {
        if(this.stacks['main'] === undefined) {
            throw new Error('Main stack not found');
        }
        return `${name}-${this.config.name}-${this.config.environment}-${this.stacks['main'].account}`;
    }

    public getArn(type:string, name: string): string {
        if(this.stacks['main'] === undefined) {
            throw new Error('Main stack not found');
        }
        return `arn:aws:${type}:${this.config.region}:${this.stacks['main'].account}:${name}`;
    }

    public getQueueByName(name: string): IQueue {

        if( !this.queues.has(name) ){
            const queueArn = this.getArn('sqs', name);
            const queue = Queue.fromQueueArn(this.stacks['main'], name, queueArn);
            this.queues.set(name, queue);            
        }

        return this.queues.get(name)!;
    }

    public setCognitoAuthorizer(name: string, authorizer: IAuthorizer, defaultAuthorizer: boolean = false) {
        this.cognitoAuthorizers[name] = authorizer;
        // If this authorizer is the default, set it as the default authorizer
        if(defaultAuthorizer) {
            this.defaultCognitoAuthorizer = authorizer;
        }
    }

    public getCognitoAuthorizer(name?: string): IAuthorizer | undefined {
        // If no name is provided and no default authorizer is set, throw an error
        if(name === undefined && this.defaultCognitoAuthorizer === undefined) {
            throw new Error('Default Cognito Authorizer not set');
        }
        // If no name is provided, return the default authorizer
        if(name === undefined) {
            return this.defaultCognitoAuthorizer;
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

    public set(name: string, value: any, prefix: string = '') {
        if(prefix.length > 0) {
            prefix = `${prefix}_`;
        }
        this.environment[`${prefix}${name}`] = value;
    }

    public get(name: string, prefix: string = ''): any {
        if(prefix.length > 0) {
            prefix = `${prefix}_`;
        }
        return this.environment[`${prefix}${name}`];
    }

    public addDynamoTable(name: string, table: TableV2) {
        this.dynamoTables[name] = table;
    }

    public getDynamoTable(name: string): TableV2{
        return this.dynamoTables[name];
    }
}