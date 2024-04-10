import { 
    AuthorizationType, 
    Cors, 
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
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

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
            paramsApi.defaultCorsPreflightOptions = {
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
                allowOrigins: this.getCors(),
            };
        }
        this.logger.debug("Creating API Gateway... ");
        // get the main stack from the framework
        this.mainStack = this.fw24.getStack("main");
        // create the api gateway
        this.api = new RestApi(this.mainStack,  `${this.fw24.appName}-api`, paramsApi);
        // add the api to the framework
        this.fw24.addStack("api", this.api);

        // sets the default controllers directory if not defined
        if(this.stackConfig.controllersDirectory === undefined || this.stackConfig.controllersDirectory === ""){
            this.stackConfig.controllersDirectory = "./src/controllers";
        }
        
        // register the controllers
        Helper.registerHandlers(this.stackConfig.controllersDirectory, this.registerController);

        if(this.fw24.hasModules()){
            const modules = this.fw24.getModules();
            this.logger.debug(" API-gateway stack: construct: app has modules ", modules);
            for(const [, module] of modules){
                const basePath = module.getBasePath();
                this.logger.debug(" load controllers from module base-path: ", basePath);
                Helper.registerControllersFromModule(module, this.registerController);
            }
        } else {
            this.logger.debug(" API-gateway stack: construct: app has NO modules ");
        }
    }

    // get the cors configuration
    private getCors(): string[] {
        if (this.stackConfig.cors === true) return Cors.ALL_ORIGINS;
        if (typeof this.stackConfig.cors === "string") return [this.stackConfig.cors];
        return this.stackConfig.cors || [];
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
        // TODO: cleanup this part
        controllerInfo.handlerInstance = new controllerInfo.handlerClass();
        const controllerName = controllerInfo.handlerInstance.controllerName;
        const controllerConfig = controllerInfo.handlerInstance?.controllerConfig;
        controllerInfo.routes = controllerInfo.handlerInstance.routes;

        this.logger.debug(`Registering controller ${controllerName} from ${controllerInfo.filePath}/${controllerInfo.fileName}`);

        // create the api resource for the controller if it doesn't exist
        const controllerResource = this.api.root.getResource(controllerName) ?? this.api.root.addResource(controllerName);

        // this.logger.debug(`Registering routes for controller ${controllerName}`, controllerInfo.routes);

        // create lambda function for the controller
        const controllerLambda = new LambdaFunction(this.mainStack, controllerName + "-controller", {
            entry: controllerInfo.filePath + "/" + controllerInfo.fileName,
            layerArn: this.fw24.getLayerARN(),
            environmentVariables: this.getEnvironmentVariables(controllerConfig),
            buckets: controllerConfig?.buckets,
            queues: controllerConfig?.queues,
            topics: controllerConfig?.topics,
            tableName: controllerConfig?.tableName,
            allowSendEmail: true
        }) as NodejsFunction;

        // create the lambda integration
        const controllerIntegration = new LambdaIntegration(controllerLambda);

        // in case of multiple authorizers in a single application, get the authorizer name
        let authorizerName = undefined;
        if(typeof controllerConfig?.authorizer === 'object') {
            authorizerName = controllerConfig.authorizer.name;
        }
      
        for (const route of Object.values(controllerInfo.routes ?? {})) {
            this.logger.debug(`Registering route ${route.httpMethod} ${route.path}`);
            let currentResource: IResource = controllerResource;
            for (const pathPart of route.path.split("/")) {
                if (pathPart === "") {
                    continue;
                }
                let childResource = currentResource.getResource(pathPart);
                if (!childResource) {
                    childResource = currentResource.addResource(pathPart);
                }
                currentResource = childResource;
            }

            const requestParameters: { [key: string]: boolean } = {};
            for (const param of route.parameters) {
                requestParameters[`method.request.path.${param}`] = true;
            }
        
            this.logger.debug(`APIGateway ~ registerController ~ add authorizer ${route.authorizer} for ${route.functionName}`);

            const methodOptions: MethodOptions = {
                requestParameters: requestParameters,
                authorizationType: route.authorizer as AuthorizationType,
                authorizer: this.fw24.getAuthorizer(route.authorizer, authorizerName),
            }

            currentResource.addMethod(route.httpMethod, controllerIntegration, methodOptions);
        }

        // output the api endpoint
        new CfnOutput(this.mainStack, `Endpoint${controllerName}`, {
            value: this.api.url + controllerResource.path.slice(1),
            description: "API Gateway Endpoint for " + controllerName,
        });
    }
}
