import { Cors, IResource, Integration, LambdaIntegration, RestApi, RestApiProps } from "aws-cdk-lib/aws-apigateway";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Architecture, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { readdirSync } from "fs";
import { resolve, join } from "path";

import { IAPIGatewayConfig } from "../interfaces/api-gateway";
import { IApplicationConfig } from "../interfaces/config";
import ControllerDescriptor from "../interfaces/controller-descriptor";
import Mutable from "../types/mutable";
import { Duration, Stack } from "aws-cdk-lib";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";

export class APIGateway {
    methods: Map<string, Integration> = new Map();
    appConfig: IApplicationConfig | undefined;
    mainStack!: Stack;
    api!: RestApi;

    constructor(private config: IAPIGatewayConfig) {
        console.log("APIGateway", config);
    }

    public construct(appConfig: IApplicationConfig) {
        console.log("APIGateway construct", appConfig);
        this.appConfig = appConfig;

        if (!this.appConfig.controllers || this.appConfig.controllers.length === 0) {
            this.appConfig.controllers = "./controllers";
        }

        const paramsApi: Mutable<RestApiProps> = this.config.apiOptions || {};

        // Enable CORS if defined
        if (this.config.cors) {
            console.log("Enabling CORS...");
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

        console.log("Creating API Gateway...");

        this.mainStack = Reflect.get(globalThis, "mainStack");
        this.api = new RestApi(this.mainStack, appConfig.name + "-api", paramsApi);

        Reflect.set(globalThis, "api", this.api);

        this.registerControllers();
    }

    private getCors(): string[] {
        if (this.config.cors === true) return Cors.ALL_ORIGINS;
        if (typeof this.config.cors === "string") return [this.config.cors];
        return this.config.cors || [];
    }

    private getLayerARN(): string {
        return `arn:aws:lambda:${this.appConfig?.region}:${this.mainStack.account}:layer:Fw24CoreLayer:${this.appConfig?.coreVersion}`;
    }

    private registerController(controllerInfo: ControllerDescriptor) {
        controllerInfo.controllerInstance = new controllerInfo.controllerClass();
        const controllerName = controllerInfo.controllerInstance.controllerName;
        const controllerConfig = controllerInfo.controllerInstance?.controllerConfig;
        controllerInfo.routes = controllerInfo.controllerInstance.routes;
        console.log(`Registering controller ${controllerName} from ${controllerInfo.filePath}/${controllerInfo.fileName}`);

        // create lambda function for the controller
        const controllerFunction = new NodejsFunction(this.mainStack, controllerName + "-controller", {
            entry: controllerInfo.filePath + "/" + controllerInfo.fileName,
            handler: "handler",
            runtime: Runtime.NODEJS_18_X,
            architecture: Architecture.ARM_64,
            layers: [LayerVersion.fromLayerVersionArn(this.mainStack, controllerName + "-Fw24CoreLayer", this.getLayerARN())],
            timeout: Duration.seconds(5),
            memorySize: 128,
            bundling: {
                sourceMap: true,
                externalModules: ["aws-sdk", "fw24-core"],
            },
        });

        if (controllerConfig?.tableName) {
            console.log("🚀 ~ APIGateway ~ registerController ~ if:", controllerConfig);

            const diRegisteredTableName = `${controllerConfig.tableName}_table`;
            const tableInstance: TableV2 = Reflect.get(globalThis, diRegisteredTableName);

            controllerFunction.addEnvironment(diRegisteredTableName.toUpperCase(), tableInstance.tableName);
            console.log("🚀 ~ APIGateway ~ registerController ~ controllerFunction.env:", controllerFunction.env);

            tableInstance.grantReadWriteData(controllerFunction);
        }

        const controllerIntegration = new LambdaIntegration(controllerFunction);
        const controllerResource = this.api.root.getResource(controllerName) ?? this.api.root.addResource(controllerName);
        console.log(`Registering routes for controller ${controllerName}`, controllerInfo.routes);
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

            currentResource.addMethod(route.httpMethod, controllerIntegration, {
                requestParameters: requestParameters,
            });
        }
    }

    private async registerControllers() {
        console.log("Registering controllers...");
        const controllersConfig = this.appConfig?.controllers || [];
        console.log("Controllers config: ", controllersConfig);

        if (typeof controllersConfig === "string") {
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
                    for (const exportedItem of Object.values(module)) {
                        if (typeof exportedItem === "function" && exportedItem.name !== "handler") {
                            const controllerInfo: ControllerDescriptor = {
                                controllerClass: exportedItem,
                                fileName: controllerPath,
                                filePath: controllersDirectory,
                            };
                            this.registerController(controllerInfo);
                            break;
                        }
                    }
                } catch (err) {
                    console.error(err);
                }
            }
        } else if (Array.isArray(controllersConfig)) {
            for (const controller of controllersConfig) {
                try {
                    this.registerController(controller);
                } catch (err) {
                    console.error(err);
                }
            }
        }
    }
}
