import { 
    AuthorizationType, 
    Cors, 
    CorsOptions,
    IResource, 
    LambdaIntegration, 
    MethodOptions, 
    RestApi, 
    RestApiProps 
} from "aws-cdk-lib/aws-apigateway";

import { Stack, CfnOutput } from "aws-cdk-lib";
import { Helper } from "../core/helper";
import { createLogger } from "../logging";
import { LambdaFunction } from "../constructs/lambda-function";
import { Fw24 } from "../core/fw24";
import { IStack } from "../interfaces/stack";
import Mutable from "../types/mutable";
import HandlerDescriptor from "../interfaces/handler-descriptor";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";

import { SESStack } from "./ses";
import { SQSStack } from "./sqs";
import { SNSStack } from "./sns";
import { DynamoDBStack } from "./dynamodb";
import { CognitoStack } from "./cognito";
import { IControllerConfig } from "../decorators/controller";

export interface IAPIGatewayConfig {
    cors?: boolean | string | string[];
    apiOptions?: RestApiProps;
    controllersDirectory?: string;
    functionProps?: NodejsFunctionProps;
}

export class APIGateway implements IStack {
    readonly logger = createLogger(APIGateway.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    api!: RestApi;
    mainStack!: Stack;
    // array of type of stacks that this stack is dependent on
    dependencies: string[] = [SESStack.name, DynamoDBStack.name, CognitoStack.name, SQSStack.name, SNSStack.name];

    // default constructor to initialize the stack configuration
    constructor(private stackConfig: IAPIGatewayConfig) {
        this.logger.debug('constructor:');

        // hydrate the config object with environment variables ex: APIGATEWAY_CONTROLLERS
        Helper.hydrateConfig(stackConfig,'APIGATEWAY');
    }

    // construct method to create the stack
    public async construct() {
        this.logger.debug('construct:');

        // set the default api options
        const paramsApi: Mutable<RestApiProps> = this.stackConfig.apiOptions || {};
        // Enable CORS if defined
        if (this.stackConfig.cors) {
            this.logger.debug("Enabling CORS... this.config.cors: ", this.stackConfig.cors);
            paramsApi.defaultCorsPreflightOptions = this.getCorsPreflightOptions();
        }
        this.logger.debug("Creating API Gateway... ");
        // get the main stack from the framework
        this.mainStack = this.fw24.getStack("main");
        // create the api gateway
        this.api = new RestApi(this.mainStack,  `${this.fw24.appName}-api`, paramsApi);
        // add the api to the framework
        this.fw24.addStack("api", this.api);

       this.registerControllers();
    }

    private registerControllers() {
         // sets the default controllers directory if not defined
        const controllersDirectory = this.stackConfig.controllersDirectory || "./src/controllers";

        // register the controllers
        Helper.registerHandlers(controllersDirectory, this.registerController);

        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            this.logger.debug("API-gateway stack: construct: app has modules ", Array.from(modules.keys()));
            for (const [, module] of modules) {
                const basePath = module.getBasePath();
                this.logger.debug("Load controllers from module base-path: ", basePath);
                Helper.registerControllersFromModule(module, this.registerController);
            }
        } else {
            this.logger.debug("API-gateway stack: construct: app has NO modules ");
        }
    }

    // get the environment variables for the controller
    private getEnvironmentVariables(controllerConfig: IControllerConfig): any {
        const env: any = {};
        for (const envConfig of controllerConfig.env || []) {
            const value = this.fw24.get(envConfig.name, envConfig.prefix || '');
            if (value) {
                env[envConfig.name] = value;
            }
        }
        return env;
    }

    // register a single controller
    private registerController = (controllerInfo: HandlerDescriptor) => {

        const { handlerClass, filePath, fileName } = controllerInfo;
        const handlerInstance = new handlerClass();
        const controllerName = handlerInstance.controllerName;
        const controllerConfig = handlerInstance?.controllerConfig;
        controllerInfo.routes = handlerInstance.routes;

        this.logger.info(`Registering controller ${controllerName} from ${filePath}/${fileName}`);

        // create the api resource for the controller if it doesn't exist
        const controllerResource = this.getOrCreateControllerResource(controllerName);

        // create lambda function for the controller
        const controllerLambda = this.createLambdaFunction(controllerName, filePath, fileName, controllerConfig);
        const controllerIntegration = new LambdaIntegration(controllerLambda);

        const { defaultAuthorizerName, defaultAuthorizerType, defaultAuthorizerGroups, defaultRequireRouteInGroupConfig } = this.extractDefaultAuthorizer(controllerConfig);

        this.logger.info(`Register Controller ~ Default Authorizer: name: ${defaultAuthorizerName} - type: ${defaultAuthorizerType} - groups: ${defaultAuthorizerGroups}`);
      
        for (const route of Object.values(controllerInfo.routes ?? {})) {
            this.logger.info(`Registering route ${route.httpMethod} ${route.path}`);
            const currentResource = this.getOrCreateRouteResource(controllerResource, route.path);

            const { routeAuthorizerName, routeAuthorizerType, routeAuthorizerGroups, routeRequireRouteInGroupConfig } = this.extractRouteAuthorizer(route, defaultAuthorizerType, defaultAuthorizerName, defaultAuthorizerGroups, defaultRequireRouteInGroupConfig);
            
            this.logger.info(`APIGateway ~ Register Route ~ Route Authorizer: ${routeAuthorizerName} - ${routeAuthorizerType} - ${routeAuthorizerGroups}`);

            const methodOptions = this.createMethodOptions(route, routeAuthorizerType, routeAuthorizerName);
            currentResource.addMethod(route.httpMethod, controllerIntegration, methodOptions);
            // if authorizer is AWS_IAM, then add the route to the policy
            if(routeAuthorizerType === 'AWS_IAM') {
                const fullRoutePath = controllerName + route.path;
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
                "X-Amz-Date",
                "Authorization",
                "X-Api-Key",
                "Access-Control-Allow-Credentials",
                "Access-Control-Allow-Headers",
                "Impersonating-User-Sub",
            ],
            allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
            allowCredentials: true,
            allowOrigins: this.getCorsOrigins(),
        };
    }

    private getCorsOrigins(): string[] {
        if (this.stackConfig.cors === true) return Cors.ALL_ORIGINS;
        if (typeof this.stackConfig.cors === "string") return [this.stackConfig.cors];
        return this.stackConfig.cors || [];
    }

    private getOrCreateControllerResource = (controllerName: string): IResource => {
        return this.api.root.getResource(controllerName) ?? this.api.root.addResource(controllerName);
    }

    private createLambdaFunction = (controllerName: string, filePath: string, fileName: string, controllerConfig: any): NodejsFunction => {
        const functionProps = {...this.stackConfig.functionProps, ...controllerConfig?.functionProps};
        return new LambdaFunction(this.mainStack, controllerName + "-controller", {
            entry: filePath + "/" + fileName,
            fw24LayerArn: this.fw24.getLayerARN(),
            environmentVariables: this.getEnvironmentVariables(controllerConfig),
            resourceAccess: controllerConfig?.resourceAccess,
            allowSendEmail: true,
            functionProps: functionProps
        }) as NodejsFunction;
    }

    private extractDefaultAuthorizer = (controllerConfig: any): { defaultAuthorizerName: string, defaultAuthorizerType: string, defaultAuthorizerGroups: string[], defaultRequireRouteInGroupConfig: boolean } => {
        let defaultAuthorizerName = 'default';
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
            authorizer: this.fw24.getAuthorizer(routeAuthorizerType, routeAuthorizerName),
        };
    }

    private outputApiEndpoint = (controllerName: string, controllerResource: IResource) => {
        new CfnOutput(this.mainStack, `Endpoint${controllerName}`, {
            value: this.api.url + controllerResource.path.slice(1),
            description: "API Gateway Endpoint for " + controllerName,
        });
    }
    
}
