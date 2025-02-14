import type {
    AuthorizationType,
    CorsOptions,
    IResource,
    MethodOptions,
    RestApiProps
} from "aws-cdk-lib/aws-apigateway";

import {
    AwsIntegration,
    Cors,
    LambdaIntegration,
    RestApi,
} from "aws-cdk-lib/aws-apigateway";

import { CfnOutput, RemovalPolicy, Stack } from "aws-cdk-lib";

import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Queue } from "aws-cdk-lib/aws-sqs";

import type { IFw24Module } from "../core/";
import type HandlerDescriptor from "../interfaces/handler-descriptor";

import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { Fw24 } from "../core/fw24";
import { Helper } from "../core/helper";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { createLogger } from "../logging";
import Mutable from "../types/mutable";
import { LambdaFunction } from "./lambda-function";

import { IControllerConfig } from "../decorators/controller";
import { ENV_KEYS } from "../fw24";
import { isArray, isString } from "../utils";
import { AuthConstruct } from "./auth";
import { CertificateConstruct } from "./certificate";
import { DynamoDBConstruct } from "./dynamodb";
import { LayerConstruct } from "./layer";
import { MailerConstruct } from "./mailer";
import { QueueConstruct } from "./queue";
import { TopicConstruct } from "./topic";
import { IConstructConfig } from "../interfaces/construct-config";

/**
 * Represents the configuration options for an API construct.
 */
export interface IAPIConstructConfig extends IConstructConfig {
    /**
     * Specifies the CORS configuration for the API.
     * It can be a boolean value, a single string, or an array of strings.
     */
    cors?: boolean | string | string[];

    /**
     * Specifies additional options for the API.
     */
    apiOptions?: RestApiProps;

    /**
     * Specifies the directory where the controllers are located.
     */
    controllersDirectory?: string;

    /**
     * Specifies the properties for the Node.js function.
     */
    functionProps?: NodejsFunctionProps;

    /**
     * Specifies the number of days to retain the API logs.
     */
    logRetentionDays?: RetentionDays;

    /**
     * Specifies the removal policy for the API logs.
     */
    logRemovalPolicy?: RemovalPolicy;

    /**
     * The custom domain name for the API.
     */
    domainName?: string;

    /**
     * The certificate ARN for the custom domain name.
     */
    certificateArn?: string;

    /**
     * Specifies if each controller should be created in a separate stack.
     */
    stackPerController?: boolean;

}

export class APIConstruct implements FW24Construct {
    readonly logger = createLogger(APIConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = APIConstruct.name;
    // array of type of stacks that this stack is dependent on
    dependencies: string[] = [MailerConstruct.name, DynamoDBConstruct.name, AuthConstruct.name, QueueConstruct.name, TopicConstruct.name, LayerConstruct.name];
    output!: FW24ConstructOutput;

    api!: RestApi;
    mainStack!: Stack;

    // default constructor to initialize the stack configuration
    constructor(private apiConstructConfig: IAPIConstructConfig) {
        // hydrate the config object with environment variables ex: APIGATEWAY_CONTROLLERS
        Helper.hydrateConfig(apiConstructConfig,'APIGATEWAY');
    }

    // construct method to create the stack
    public async construct() {

        // set the default api options
        const paramsApi: Mutable<RestApiProps> = this.apiConstructConfig.apiOptions || {};
        // Enable CORS if defined
        if (this.apiConstructConfig.cors) {
            this.logger.debug("Enabling CORS... this.config.cors: ", this.apiConstructConfig.cors);
            paramsApi.defaultCorsPreflightOptions = this.getCorsPreflightOptions();
        }
        if(this.apiConstructConfig.domainName && this.apiConstructConfig.domainName.length > 0){
            const certificateConstruct = new CertificateConstruct({
                domainName: this.apiConstructConfig.domainName,
                certificateArn: this.apiConstructConfig.certificateArn
            });
            certificateConstruct.construct();
            const certificate = certificateConstruct.output[OutputType.CERTIFICATE][this.apiConstructConfig.domainName];
            paramsApi.domainName = {
                domainName: this.apiConstructConfig.domainName,
                certificate: certificate,
                basePath: paramsApi.deployOptions?.stageName || '/',
            };
        }
        this.logger.debug("Creating API Gateway... ");
        // get the main stack from the framework
        this.mainStack = this.fw24.getStack(this.apiConstructConfig.stackName || "main");
        // create the api gateway
        this.api = new RestApi(this.mainStack,  `${this.fw24.appName}-api`, paramsApi);
        // add the api to the framework
        this.fw24.addStack("api", this.api);

       await this.registerControllers();
    }

    private getStack = (controllerName: string): Stack => {
        let currentStack: Stack = this.mainStack;
    
        if (controllerName && this.apiConstructConfig.stackPerController && this.apiConstructConfig.stackPerController === true) {
            currentStack = this.fw24.getStack(controllerName);
            if (!currentStack) {
                currentStack = new Stack(this.fw24.getApp(), `${this.fw24.appName}-api-${controllerName}-stack`, {
                    env: {
                        account: this.mainStack.account,
                        region: this.mainStack.region
                    }
                })
                this.fw24.addStack(controllerName, currentStack);
            }
        }
        return currentStack;
    }

    private async registerControllers() {
         // sets the default controllers directory if not defined
        const controllersDirectory = this.apiConstructConfig.controllersDirectory || "./src/controllers";

        // register the controllers
        await Helper.registerHandlers(controllersDirectory, this.registerController);

        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            this.logger.debug("API-gateway stack: construct: app has modules ", Array.from(modules.keys()));
            for (const [, module] of modules) {
                const basePath = module.getBasePath();
                
                this.logger.debug("Load controllers from module base-path: ", basePath);
                
                Helper.registerControllersFromModule(
                    module,                     
                    (desc: HandlerDescriptor) => this.registerController(desc, module)
                );
            }
        } else {
            this.logger.debug("API-gateway stack: construct: app has NO modules ");
        }
    }

    private prepareEntryPackages(controllerConfig: IControllerConfig, ownerModule?: IFw24Module): string[] {
        let entryPackages = controllerConfig.entryPackages || [];
        
        if(isArray(entryPackages)){
            entryPackages = {
                override: false,
                packageNames: entryPackages
            }
        }

        // if the controller does not want to override the application/module entry packages and include them as well
        if( !entryPackages.override){
            const moduleEntryPackages = ownerModule?.getLambdaEntryPackages() || [];
            const appEntryPackages = this.fw24.getLambdaEntryPackages();
            entryPackages.packageNames = [
                ...entryPackages.packageNames,
                ...moduleEntryPackages,
                ...appEntryPackages
            ];
        }

        return entryPackages.packageNames.map(this.fw24.tryResolveEnvKeyTemplate);
    }


    // register a single controller
    private registerController = (controllerInfo: HandlerDescriptor, ownerModule?: IFw24Module) => {

        const { handlerClass, filePath, fileName } = controllerInfo;
        // TODO: no need to create na instance of the controller class
        // use metadata from the class prototype
        const handlerInstance = new handlerClass();
        const controllerName = handlerInstance.controllerName;
        const controllerConfig: IControllerConfig = handlerInstance?.controllerConfig || {};
        controllerInfo.routes = handlerInstance.routes;

        this.logger.info(`Registering controller ${controllerName} from ${filePath}/${fileName}`);

        // prepare the entry packages for the controller's lambda function
        const entryPackages = this.prepareEntryPackages(controllerConfig, ownerModule);
        controllerConfig.entryPackages = entryPackages;

        // create the api resource for the controller if it doesn't exist
        const controllerResource = this.getOrCreateControllerResource(controllerName);

        var controllerTarget = controllerConfig.target;
        var controllerIntegration: any;
        // create lambda function for the controller
        if (controllerTarget === 'function' || controllerTarget === undefined) {
            controllerConfig.logRetentionDays = controllerConfig.logRetentionDays || this.apiConstructConfig.logRetentionDays;
            controllerConfig.logRemovalPolicy = controllerConfig.logRemovalPolicy || this.apiConstructConfig.logRemovalPolicy;
            const controllerLambda = this.createLambdaFunction(controllerName, filePath, fileName, controllerConfig);
            this.fw24.setConstructOutput(this, controllerName, controllerLambda, OutputType.FUNCTION);

            controllerIntegration = new LambdaIntegration(controllerLambda);
        } 

        const { defaultAuthorizerName, defaultAuthorizerType, defaultAuthorizerGroups, defaultRequireRouteInGroupConfig } = this.extractDefaultAuthorizer(controllerConfig);

        this.logger.debug(`Register Controller ~ Default Authorizer: name: ${defaultAuthorizerName} - type: ${defaultAuthorizerType} - groups: ${defaultAuthorizerGroups}`);
      
        for (const route of Object.values(controllerInfo.routes ?? {})) {
            this.logger.debug(`Registering route ${route.httpMethod} ${route.path}`);
            const routeTarget = route.target || controllerTarget;
            const currentResource = this.getOrCreateRouteResource(controllerResource, route.path);
            const { routeAuthorizerName, routeAuthorizerType, routeAuthorizerGroups, routeRequireRouteInGroupConfig } = this.extractRouteAuthorizer(route, defaultAuthorizerType, defaultAuthorizerName, defaultAuthorizerGroups, defaultRequireRouteInGroupConfig);            
            this.logger.debug(`Registering route Authorizer: ${routeAuthorizerName} - ${routeAuthorizerType} - ${routeAuthorizerGroups}`);
            let methodOptions = this.createMethodOptions(route, routeAuthorizerType, routeAuthorizerName);
            
            if (routeTarget === 'queue') {
                const queueName = route.path.replace('/', '');
                controllerIntegration = this.createSQSIntegration(queueName, controllerName);
                methodOptions = {
                    ...methodOptions,
                    methodResponses: [
                        {
                            statusCode: "202",
                        },
                        {
                            statusCode: "400",
                        },
                        {
                            statusCode: "500",
                        },
                    ],
                }
            } else if (routeTarget === 'topic') {
                const topicName = route.path.replace('/', '');
                controllerIntegration = this.createSNSIntegration(topicName, controllerName);
                methodOptions = {
                    ...methodOptions,
                    methodResponses: [
                        {
                            statusCode: "202",
                        },
                        {
                            statusCode: "400",
                        },
                        {
                            statusCode: "500",
                        },
                    ],
                }
            }

            currentResource.addMethod(route.httpMethod, controllerIntegration, methodOptions);
            // if authorizer is AWS_IAM, then add the route to the policy
            if(routeAuthorizerType === 'AWS_IAM') {
                let fullRoutePath = controllerName + route.path;

                // * replace each param placeholder `{id}` with an `*`
                route.parameters?.forEach( par => {
                    fullRoutePath = fullRoutePath.replace(`{${par}}`, '*'); 
                })

                this.fw24.addRouteToRolePolicy(fullRoutePath, routeAuthorizerGroups, routeRequireRouteInGroupConfig);
            }
        }

        // output the api endpoint
        this.outputApiEndpoint(controllerName, controllerResource);
    }

    private getCorsPreflightOptions(): CorsOptions {
        return {
            allowHeaders: [
                "Content-Type",
                "Authorization",
                "X-Api-Key",
                "X-Amz-Date",
                "X-Amz-Content-Sha256",
                "X-Amz-Security-Token",
                "Access-Control-Allow-Credentials",
                "Access-Control-Allow-Headers",
                "Access-Control-Allow-Origin",
                "Impersonating-User-Sub",
            ],
            allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
            allowCredentials: true,
            allowOrigins: this.getCorsOrigins(),
        };
    }

    private getCorsOrigins(): string[] {
        if (this.apiConstructConfig.cors === true) return Cors.ALL_ORIGINS;
        if (typeof this.apiConstructConfig.cors === "string") return [this.apiConstructConfig.cors];
        return this.apiConstructConfig.cors || [];
    }

    private getOrCreateControllerResource = (controllerName: string): IResource => {
        if(this.apiConstructConfig.stackPerController){
            let currentStack = this.getStack(controllerName);
            this.logger.debug(`Creating controller resource for ${controllerName} in a separate stack ${currentStack.stackName}`);
            let restAPI = RestApi.fromRestApiAttributes(currentStack, `${this.fw24.appName}-${controllerName}-api`, {
                restApiId: this.api.restApiId,
                rootResourceId: this.api.restApiRootResourceId
            });
            return restAPI.root.getResource(controllerName) ?? restAPI.root.addResource(controllerName);
        }
        return this.api.root.getResource(controllerName) ?? this.api.root.addResource(controllerName);
    }

    private createLambdaFunction = (controllerName: string, filePath: string, fileName: string, controllerConfig: IControllerConfig): NodejsFunction => {
        const functionProps = {...this.apiConstructConfig.functionProps, ...controllerConfig?.functionProps};
        
        const envVariables = this.fw24.resolveEnvVariables(controllerConfig.env);
       
        // do not override the entry packages if already set
        if( !(ENV_KEYS.ENTRY_PACKAGES in envVariables) && controllerConfig.entryPackages){
            envVariables[ENV_KEYS.ENTRY_PACKAGES] = (controllerConfig.entryPackages as Array<string>).join(',');
        }

        return new LambdaFunction(this.getStack(controllerName), controllerName + "-controller", {
            entry: filePath + "/" + fileName,
            environmentVariables: envVariables,
            policies: controllerConfig?.policies,
            resourceAccess: controllerConfig?.resourceAccess,
            allowSendEmail: true,
            functionTimeout: controllerConfig?.functionTimeout,
            processorArchitecture: controllerConfig?.processorArchitecture,
            functionProps: functionProps,
            logRetentionDays: controllerConfig.logRetentionDays,
            logRemovalPolicy: controllerConfig.logRemovalPolicy,
        }) as NodejsFunction;
    }

    private extractDefaultAuthorizer = (controllerConfig: any): { defaultAuthorizerName: string, defaultAuthorizerType: string, defaultAuthorizerGroups: string[], defaultRequireRouteInGroupConfig: boolean } => {
        let defaultAuthorizerName = this.fw24.getDefaultCognitoAuthorizerName();
        let defaultAuthorizerType;
        let defaultAuthorizerGroups;
        let defaultRequireRouteInGroupConfig = false;
    
        if (Array.isArray(controllerConfig?.authorizer)) {
            const defaultAuthorizer = controllerConfig.authorizer.find((auth: any) => auth.default) || controllerConfig.authorizer[0];
            defaultAuthorizerName = defaultAuthorizer.name || defaultAuthorizerName;
            defaultAuthorizerType = defaultAuthorizer.type;
            defaultAuthorizerGroups = defaultAuthorizer.groups || [];
            defaultRequireRouteInGroupConfig = defaultAuthorizer.requireRouteInGroupConfig || defaultRequireRouteInGroupConfig;
        } else if (typeof controllerConfig.authorizer === 'object') {
            defaultAuthorizerName = controllerConfig.authorizer.name || defaultAuthorizerName;
            defaultAuthorizerType = controllerConfig.authorizer.type;
            defaultAuthorizerGroups = controllerConfig.authorizer.groups || [];
            defaultRequireRouteInGroupConfig = controllerConfig.requireRouteInGroupConfig || defaultRequireRouteInGroupConfig;
        } else {
            defaultAuthorizerType = controllerConfig.authorizer;
        }

        if(!defaultAuthorizerType && this.fw24.getConfig().defaultAuthorizationType) {
            defaultAuthorizerType = this.fw24.getConfig().defaultAuthorizationType;
        }

        if(defaultAuthorizerGroups){

            // if the value for the groups is a template string, 
            // resolve it [when the application want to allow multiple user groups to have access]
            // when the value is like "env:xxx:group1" ==> "group1-resolved" || "group1,group2" || "env:xxx:group1,env:xxx:group2"
            if(isString(defaultAuthorizerGroups)) {
                defaultAuthorizerGroups = this.fw24.tryResolveEnvKeyTemplate(defaultAuthorizerGroups)
            }
            // now if the resolved value is again a string, split it by comma
            // when the value is like "group1,group2" ==> ["group1", "group2"]
            if(isString(defaultAuthorizerGroups)) {
                defaultAuthorizerGroups = defaultAuthorizerGroups.split(',');
            }

            if(!defaultAuthorizerGroups.length && this.fw24.getConfig().defaultAdminGroups){
                defaultAuthorizerGroups = this.fw24.getConfig().defaultAdminGroups;
            }
            
            // resolve the group names from fw24-scope if it's a template
            // when the value is like ["env:xxx:group1","env:xxx:group2"] ==> ["group1-resolved", "group2-resolved"]
            defaultAuthorizerGroups = (defaultAuthorizerGroups as Array<string>).map(this.fw24.tryResolveEnvKeyTemplate);
    
            // flat-map the groups if they resolved group values are again comma separated
            // when the resolved value is like ["a,b", "c,d"] ==> ["a", "b", "c", "d"]
            defaultAuthorizerGroups = (defaultAuthorizerGroups as Array<string>).flatMap((group: string) => group.split(','));
        }
    
        return { defaultAuthorizerName, defaultAuthorizerType, defaultAuthorizerGroups, defaultRequireRouteInGroupConfig };
    }

    private getOrCreateRouteResource = (parentResource: IResource, path: string): IResource => {
        let currentResource: IResource = parentResource;
    
        for (const pathPart of path.split("/")) {
            if (pathPart === "") {
                continue;
            }
    
            let childResource = currentResource.getResource(pathPart);
            if (!childResource) {
                childResource = currentResource.addResource(pathPart);
            }
            currentResource = childResource;
        }

        return currentResource;
    }

    private extractRouteAuthorizer = (route: any, defaultAuthorizerType: string, defaultAuthorizerName: string, defaultAuthorizerGroups: string[], defaultRequireRouteInGroupConfig: boolean): { routeAuthorizerName: string, routeAuthorizerType: string, routeAuthorizerGroups: string[], routeRequireRouteInGroupConfig: boolean } => {
        let routeAuthorizerName = defaultAuthorizerName;
        let routeAuthorizerType = defaultAuthorizerType;
        let routeAuthorizerGroups = defaultAuthorizerGroups;
        let routeRequireRouteInGroupConfig = defaultRequireRouteInGroupConfig;
    
        if (route.authorizer && typeof route.authorizer === 'object') {
            routeAuthorizerType = route.authorizer.type || defaultAuthorizerType;
            routeAuthorizerName = route.authorizer.name || defaultAuthorizerName;
            routeAuthorizerGroups = route.authorizer.groups || defaultAuthorizerGroups;
            routeRequireRouteInGroupConfig = route.authorizer.requireRouteInGroupConfig || defaultRequireRouteInGroupConfig;
        } else if (typeof route.authorizer === 'string') {
            routeAuthorizerType = route.authorizer;
        }
    
        return { routeAuthorizerName, routeAuthorizerType, routeAuthorizerGroups, routeRequireRouteInGroupConfig };
    }

    private createMethodOptions = (route: any, routeAuthorizerType: string, routeAuthorizerName: string | undefined): MethodOptions => {
        const requestParameters: { [key: string]: boolean } = {};
        for (const param of route.parameters) {
            requestParameters[`method.request.path.${param}`] = true;
        }
    
        return {
            requestParameters,
            authorizationType: routeAuthorizerType as AuthorizationType,
            authorizer: this.fw24.getAuthorizer(routeAuthorizerType, routeAuthorizerName)
        };
    }

    private createSQSIntegration = (queueName: string, controllerName: string): AwsIntegration => {
        const integrationRole = new Role(this.getStack(controllerName), controllerName + "-sqs-integration-role", {
            assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
        });
        const queueInstance: Queue = this.fw24.getEnvironmentVariable(queueName,'queue');
        queueInstance.grantSendMessages(integrationRole);
        return new AwsIntegration({
            service: "sqs",
            path: this.fw24.getConfig().account + "/" + queueInstance.queueName,
            integrationHttpMethod: "POST",
            options: {
                credentialsRole: integrationRole,
                requestParameters: {
                    "integration.request.header.Content-Type": "'application/x-www-form-urlencoded'",
                },
                requestTemplates: {
                    "application/json": `Action=SendMessage&MessageBody=$util.urlEncode($input.body)`,
                },
                integrationResponses: [
                    {
                        statusCode: "202",
                    },
                    {
                        statusCode: "400",
                    },
                    {
                        statusCode: "500",
                    },
                ],
            },
        });
    }

    private createSNSIntegration = (topicName: string, controllerName: string): AwsIntegration => {
        const integrationRole = new Role(this.getStack(controllerName), controllerName + "-sns-integration-role", {
            assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
        });
        const topicInstance: Topic = this.fw24.getEnvironmentVariable(topicName, 'topic');
        topicInstance.grantPublish(integrationRole);
        return new AwsIntegration({
            service: "sns",
            path: '/',
            integrationHttpMethod: "POST",
            options: {
                credentialsRole: integrationRole,                
                requestParameters: {
                    "integration.request.header.Content-Type": "'application/x-www-form-urlencoded'",
                },
                requestTemplates: {
                    "application/json": `Action=Publish&TopicArn=$util.urlEncode(\'${topicInstance.topicArn}\')&Message=$util.urlEncode($input.body)`,
                },
                integrationResponses: [
                    {
                        statusCode: "202",
                    },
                    {
                        statusCode: "400",
                    },
                    {
                        statusCode: "500",
                    },
                ],
            },
        });
    }

    private outputApiEndpoint = (controllerName: string, controllerResource: IResource) => {
        new CfnOutput(this.getStack(controllerName), `Endpoint${controllerName}`, {
            value: this.api.url + controllerResource.path.slice(1),
            description: "API Gateway Endpoint for " + controllerName,
        });
    }
    
}
