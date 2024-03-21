import { IAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2';
import { IApplicationConfig } from '../interfaces/config';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Helper } from './helper';

export class Fw24 {
    public appName: string = "fw24";
    private stacks: any = {};
    private environment: any = {};
    private cognitoAuthorizer!: IAuthorizer;
    private dynamoTables: { [key: string]: TableV2 } = {};

    constructor(private config: IApplicationConfig) {
        // Hydrate the config object with environment variables
        Helper.hydrateConfig(config);

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

    public setCognitoAuthorizer(authorizer: IAuthorizer) {
        this.cognitoAuthorizer = authorizer;
    }

    public getCognitoAuthorizer(): IAuthorizer {
        return this.cognitoAuthorizer;
    }

    public getAuthorizer(authorizationType: string): IAuthorizer | undefined {
        if(authorizationType === "COGNITO_USER_POOLS") {
            return this.getCognitoAuthorizer();
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