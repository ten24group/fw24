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
import { IControllerConfig } from "../fw24";
import { LambdaFunction } from "../constructs/lambda-function";
import { Fw24 } from "../core/fw24";
import { IStack } from "../interfaces/stack";
import Mutable from "../types/mutable";
import HandlerDescriptor from "../interfaces/handler-descriptor";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

export interface IAPIGatewayConfig {
    cors?: boolean | string | string[];
    apiOptions?: RestApiProps;
    controllersDirectory?: string;
}

export class APIGateway implements IStack {
    fw24: Fw24 = Fw24.getInstance();
    // array of type of stacks that this stack is dependent on
    dependencies: string[] = ['SESStack', 'DynamoDBStack', 'CognitoStack', 'SQSStack', 'SNSStack'];
    mainStack!: Stack;
    api!: RestApi;

    // default constructor to initialize the stack configuration
    constructor(private stackConfig: IAPIGatewayConfig) {
        // hydrate the config object with environment variables ex: APIGATEWAY_CONTROLLERS
        Helper.hydrateConfig(stackConfig,'APIGATEWAY');
    }

    // construct method to create the stack
    public construct() {
        console.log("APIGateway construct");
        // set the default api options
        const paramsApi: Mutable<RestApiProps> = this.stackConfig.apiOptions || {};
        // Enable CORS if defined
        if (this.stackConfig.cors) {
            console.log("Enabling CORS... this.config.cors: ", this.stackConfig.cors);
            paramsApi.defaultCorsPreflightOptions = this.getCorsPreflightOptions();
        }
        console.log("Creating API Gateway... ");
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
            console.log("API-gateway stack: construct: app has modules ", modules);
            for (const [, module] of modules) {
                const basePath = module.getBasePath();
                console.log("Load controllers from module base-path: ", basePath);
                Helper.registerControllersFromModule(module, this.registerController);
            }
        } else {
            console.log("API-gateway stack: construct: app has NO modules ");
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

        console.log(`Registering controller ${controllerName} from ${filePath}/${fileName}`);

        // create the api resource for the controller if it doesn't exist
        const controllerResource = this.getOrCreateControllerResource(controllerName);

        // create lambda function for the controller
        const controllerLambda = this.createLambdaFunction(controllerName, filePath, fileName, controllerConfig);
        const controllerIntegration = new LambdaIntegration(controllerLambda);

        const { controllerAuthorizerName, controllerAuthorizerType } = this.extractControllerAuthorizer(controllerConfig);

        console.log(`APIGateway ~ registerController ~ Default Authorizer: ${controllerAuthorizerName} - ${controllerAuthorizerType}`);
      
        for (const route of Object.values(controllerInfo.routes ?? {})) {
            console.log(`Registering route ${route.httpMethod} ${route.path}`);
            const currentResource = this.getOrCreateRouteResource(controllerResource, route.path);

            const methodOptions = this.createMethodOptions(route, controllerAuthorizerType, controllerAuthorizerName);
            currentResource.addMethod(route.httpMethod, controllerIntegration, methodOptions);
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
        return new LambdaFunction(this.mainStack, controllerName + "-controller", {
            entry: filePath + "/" + fileName,
            layerArn: this.fw24.getLayerARN(),
            environmentVariables: this.getEnvironmentVariables(controllerConfig),
            buckets: controllerConfig?.buckets,
            queues: controllerConfig?.queues,
            topics: controllerConfig?.topics,
            tableName: controllerConfig?.tableName,
            allowSendEmail: true
        }) as NodejsFunction;
    }

    private extractControllerAuthorizer = (controllerConfig: any): { controllerAuthorizerName: string, controllerAuthorizerType: string } => {
        let controllerAuthorizerName;
        let controllerAuthorizerType;
    
        if (Array.isArray(controllerConfig?.authorizer)) {
            const defaultAuthorizer = controllerConfig.authorizer.find((auth: any) => auth.default) || controllerConfig.authorizer[0];
            controllerAuthorizerName = defaultAuthorizer.name;
            controllerAuthorizerType = defaultAuthorizer.type;
        } else {
            controllerAuthorizerType = controllerConfig.authorizer;
        }
    
        return { controllerAuthorizerName, controllerAuthorizerType };
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

    private createMethodOptions = (route: any, controllerAuthorizerType: string, controllerAuthorizerName: string | undefined): MethodOptions => {
        const requestParameters: { [key: string]: boolean } = {};
        for (const param of route.parameters) {
            requestParameters[`method.request.path.${param}`] = true;
        }
    
        let routeAuthorizerName = controllerAuthorizerName
        let routeAuthorizerType = controllerAuthorizerType;
    
        if (route.authorizer && typeof route.authorizer === 'object') {
            routeAuthorizerName = route.authorizer.name;
            routeAuthorizerType = route.authorizer.type;
        } else if (typeof route.authorizer === 'string') {
            routeAuthorizerType = route.authorizer;
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
