import { AuthorizationType, Cors, IResource, Integration, LambdaIntegration, MethodOptions, RestApi, RestApiProps } from "aws-cdk-lib/aws-apigateway";
import { readdirSync } from "fs";
import { resolve, join } from "path";

import { IAPIGatewayConfig } from "../interfaces/apigateway";
import { IApplicationConfig } from "../interfaces/config";
import ControllerDescriptor from "../interfaces/controller-descriptor";
import Mutable from "../types/mutable";
import { Stack, CfnOutput } from "aws-cdk-lib";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Helper } from "../core/helper";
import { IControllerConfig } from "../fw24";
import { LambdaFunction } from "../constructs/lambda-function";
import { Fw24 } from "../core/fw24";
import { IStack } from "../interfaces/stack";

export class APIGateway implements IStack {
    methods: Map<string, Integration> = new Map();
    appConfig: IApplicationConfig | undefined;
    mainStack!: Stack;
    api!: RestApi;
    fw24!: Fw24;

    // default contructor to initialize the stack configuration
    constructor(private config: IAPIGatewayConfig) {
        console.log("APIGateway", config);
        // hydrate the config object with environment variables ex: APIGATEWAY_CONTROLLERS
        Helper.hydrateConfig(config,'APIGATEWAY');
    }

    // construct method to create the stack
    public construct(fw24: Fw24) {
        console.log("APIGateway construct");
        // make the fw24 instance available to the class
        this.fw24 = fw24;
        // make the appConfig available to the class
        this.appConfig = fw24.getConfig();
        // set the default api options
        const paramsApi: Mutable<RestApiProps> = this.config.apiOptions || {};
        // Enable CORS if defined
        if (this.config.cors) {
            console.log("Enabling CORS... this.config.cors: ", this.config.cors);
            
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
        console.log("Creating API Gateway... paramsApi: ", paramsApi);
        // get the main stack from the framework
        this.mainStack = fw24.getStack("main");
        // create the api gateway
        this.api = new RestApi(this.mainStack,  `${fw24.appName}-api`, paramsApi);
        // add the api to the framework
        fw24.addStack("api", this.api);
        // register the controllers
        this.registerControllers();
    }

    // get the cors configuration
    private getCors(): string[] {
        if (this.config.cors === true) return Cors.ALL_ORIGINS;
        if (typeof this.config.cors === "string") return [this.config.cors];
        return this.config.cors || [];
    }

    // register the controllers
    private async registerControllers() {
        console.log("Registering controllers...");
        // get the controllers config, default to ./src/controllers
        const controllersConfig = this.config.controllers || "./src/controllers";
        console.log("Controllers config: ", controllersConfig);
        // Resolve the absolute path
        const controllersDirectory = resolve(controllersConfig);
        // Get all the files in the controllers directory
        const controllerFiles = readdirSync(controllersDirectory);
        // Filter the files to only include TypeScript files
        const controllerPaths = controllerFiles.filter((file) => file.endsWith(".ts"));

        for (const controllerPath of controllerPaths) {
            try {
                // Dynamically import the controller file
                const module = await import(join(controllersDirectory, controllerPath));

                // Find and instantiate controller classes
                const controllerClasses = Object.values(module).filter(
                    (exportedItem) => typeof exportedItem === "function" && exportedItem.name !== "handler"
                );

                for (const controllerClass of controllerClasses) {
                    const controllerInfo: ControllerDescriptor = {
                        controllerClass,
                        fileName: controllerPath,
                        filePath: controllersDirectory,
                    };
                    this.registerController(controllerInfo);
                }
            } catch (err) {
                console.error("Error registering controller:", controllerPath, err);
            }
        } 
    }

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
    private registerController(controllerInfo: ControllerDescriptor) {
        // TODO: cleanup this part
        controllerInfo.controllerInstance = new controllerInfo.controllerClass();
        const controllerName = controllerInfo.controllerInstance.controllerName;
        const controllerConfig = controllerInfo.controllerInstance?.controllerConfig;
        controllerInfo.routes = controllerInfo.controllerInstance.routes;

        console.log(`Registering controller ${controllerName} from ${controllerInfo.filePath}/${controllerInfo.fileName}`);

        // create the api resource for the controller if it doesn't exist
        const controllerResource = this.api.root.getResource(controllerName) ?? this.api.root.addResource(controllerName);

        console.log(`Registering routes for controller ${controllerName}`, controllerInfo.routes);

        // create lambda function for the controller
        const controllerLambda = new LambdaFunction(this.mainStack, controllerName + "-controller", {
            entry: controllerInfo.filePath + "/" + controllerInfo.fileName,
            layerArn: this.fw24.getLayerARN(),
            env: this.getEnvironmentVariables(controllerConfig),
        });


        // belongs here? TBD
        if (controllerConfig?.tableName) {
            console.log("🚀 ~ APIGateway ~ registerController ~ if:", controllerConfig);

            const diRegisteredTableName = `${controllerConfig.tableName}_table`;
            const tableInstance: TableV2 = this.fw24.getDynamoTable(controllerConfig.tableName);

            controllerLambda.fn.addEnvironment(diRegisteredTableName.toUpperCase(), tableInstance.tableName);
            console.log("🚀 ~ APIGateway ~ registerController ~ controllerFunction.env:", controllerLambda.fn.env);

            tableInstance.grantReadWriteData(controllerLambda.fn);
        }
    
        // create the lambda integration
        const controllerIntegration = new LambdaIntegration(controllerLambda.fn);
      

        for (const route of Object.values(controllerInfo.routes ?? {})) {
            console.log(`Registering route ${route.httpMethod} ${route.path}`);
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
        
            console.log(`APIGateway ~ registerController ~ add authorizer ${route.authorizer} for ${route.functionName}`);

            const methodOptions: MethodOptions = {
                requestParameters: requestParameters,
                authorizationType: route.authorizer as AuthorizationType,
                authorizer: this.fw24.getAuthorizer(route.authorizer),
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
