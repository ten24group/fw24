import { Cors, IResource, Integration, LambdaIntegration, RestApi, RestApiProps, AuthorizationType } from "aws-cdk-lib/aws-apigateway";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Architecture, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { readdirSync } from "fs";
import { resolve, join } from "path";

import { IAPIGatewayConfig } from "../interfaces/apigateway";
import { IApplicationConfig } from "../interfaces/config";
import ControllerDescriptor from "../interfaces/controller-descriptor";
import Mutable from "../types/mutable";
import { Duration, Stack, CfnOutput } from "aws-cdk-lib";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Helper } from "../core/helper";
import { IAuthorizerConfig, ILambdaEnvConfig } from "../fw24";

export class APIGateway {
    methods: Map<string, Integration> = new Map();
    appConfig: IApplicationConfig | undefined;
    mainStack!: Stack;
    api!: RestApi;

    constructor(private config: IAPIGatewayConfig) {
        console.log("APIGateway", config);
        Helper.hydrateConfig(config,'APIGATEWAY');

        if (!this.config.controllers || this.config.controllers.length === 0) {
            this.config.controllers = "./controllers";
        }
    }

    public construct(appConfig: IApplicationConfig) {
        console.log("APIGateway construct", appConfig, this.config);
        this.appConfig = appConfig;

        if (!this.config.controllers || this.config.controllers.length === 0) {
            throw new Error("No controllers defined");
        }

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
            runtime: Runtime.NODEJS_18_X, // define from controller decorator
            architecture: Architecture.ARM_64, // define from controller decorator
            layers: [LayerVersion.fromLayerVersionArn(this.mainStack, controllerName + "-Fw24CoreLayer", this.getLayerARN())],
            timeout: Duration.seconds(5), // define from controller decorator
            memorySize: 128, // define from controller decorator
            // lambda IAM role
            bundling: {
                sourceMap: true,
                externalModules: ["aws-sdk", "fw24"], // review fw24-core
            },
        });

        // add environment variables from controller config
        controllerConfig?.env.forEach( ( lambdaEnv: ILambdaEnvConfig ) => {
            if (lambdaEnv.path === "globalThis") {
                controllerFunction.addEnvironment(lambdaEnv.name, Reflect.get(globalThis, lambdaEnv.name));
            }
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
        // output the api endpoint
        new CfnOutput(this.mainStack, `Endpoint${controllerName}`, {
            value: this.api.url + controllerResource.path.slice(1),
            description: "API Gateway Endpoint for " + controllerName,
        });
        console.log(`Registering routes for controller ${controllerName}`, controllerInfo.routes);
        // setup authorizer struct
        var defaultAuthorizationType: any = this.appConfig?.defaultAuthorizationType || AuthorizationType.NONE;
        var routeAuthorizers: any = {};
        controllerConfig?.authorizers.forEach( ( authorizer: IAuthorizerConfig ) => {
            if (authorizer.default) {
                defaultAuthorizationType = authorizer.type; 
            }
            authorizer?.secureMethods?.forEach( ( route: string ) => {
                routeAuthorizers[route] = authorizer.type;
            })     
        });

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

            var authorizationType = defaultAuthorizationType;
            var authorizer = undefined;

            // check if authorizer is defined
            if (routeAuthorizers?.[route.functionName] != undefined) {
                authorizationType = routeAuthorizers[route.functionName];
            } else {
                authorizationType = defaultAuthorizationType;
            }
            if ( authorizationType === AuthorizationType.COGNITO) {
                authorizer = Reflect.get(globalThis, "userPoolAuthorizer");
            }
        
            console.log(`APIGateway ~ registerController ~ add authorizer ${authorizationType} for ${route.functionName}`);

            // TODO: link the api input schema
            // const modell = this.api.addModel('test', {
            //     schema: {
            //         type: JsonSchemaType.OBJECT,
            //         properties: {
            //             userId: {
            //                 type: JsonSchemaType.STRING
            //             },
            //             name: {
            //                 type: JsonSchemaType.STRING
            //             }
            //         },
            //         required: ['userId']
            //     }
            // });

            currentResource.addMethod(route.httpMethod, controllerIntegration, {
                requestParameters: requestParameters,
                authorizationType: authorizationType,
                authorizer: authorizer,
                // requestModels: {
                //     'application/json': modell
                // }
            });
        }


    }

    private async registerControllers() {
        console.log("Registering controllers...");
        const controllersConfig = this.config.controllers || [];
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
