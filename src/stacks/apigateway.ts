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
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Helper } from "../core/helper";
import { IControllerConfig } from "../fw24";
import { LambdaFunction } from "../constructs/lambda-function";
import { Fw24 } from "../core/fw24";
import { IStack } from "../interfaces/stack";

import Mutable from "../types/mutable";
import HandlerDescriptor from "../interfaces/handler-descriptor";

export interface IAPIGatewayConfig {
    cors?: boolean | string | string[];
    apiOptions?: RestApiProps;
    controllersDirectory?: string;
}

export class APIGateway implements IStack {
    mainStack!: Stack;
    api!: RestApi;
    fw24!: Fw24;

    // default contructor to initialize the stack configuration
    constructor(private stackConfig: IAPIGatewayConfig) {
        // hydrate the config object with environment variables ex: APIGATEWAY_CONTROLLERS
        Helper.hydrateConfig(stackConfig,'APIGATEWAY');
    }

    // construct method to create the stack
    public construct(fw24: Fw24) {
        console.log("APIGateway construct");
        // make the fw24 instance available to the class
        this.fw24 = fw24;
        // set the default api options
        const paramsApi: Mutable<RestApiProps> = this.stackConfig.apiOptions || {};
        // Enable CORS if defined
        if (this.stackConfig.cors) {
            console.log("Enabling CORS... this.config.cors: ", this.stackConfig.cors);
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
        console.log("Creating API Gateway... ");
        // get the main stack from the framework
        this.mainStack = fw24.getStack("main");
        // create the api gateway
        this.api = new RestApi(this.mainStack,  `${fw24.appName}-api`, paramsApi);
        // add the api to the framework
        fw24.addStack("api", this.api);
        // sets the default controllers directory if not defined
        if(this.stackConfig.controllersDirectory === undefined || this.stackConfig.controllersDirectory === ""){
            this.stackConfig.controllersDirectory = "./src/controllers";
        }
        // register the controllers
        Helper.registerHandlers(this.stackConfig.controllersDirectory, this.registerController);
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
    private registerController(controllerInfo: HandlerDescriptor) {
        // TODO: cleanup this part
        controllerInfo.handlerInstance = new controllerInfo.handlerClass();
        const controllerName = controllerInfo.handlerInstance.controllerName;
        const controllerConfig = controllerInfo.handlerInstance?.controllerConfig;
        controllerInfo.routes = controllerInfo.handlerInstance.routes;

        console.log(`Registering controller ${controllerName} from ${controllerInfo.filePath}/${controllerInfo.fileName}`);

        // create the api resource for the controller if it doesn't exist
        const controllerResource = this.api.root.getResource(controllerName) ?? this.api.root.addResource(controllerName);

        console.log(`Registering routes for controller ${controllerName}`, controllerInfo.routes);

        // create lambda function for the controller
        const controllerLambda = new LambdaFunction(this.mainStack, controllerName + "-controller", {
            entry: controllerInfo.filePath + "/" + controllerInfo.fileName,
            layerArn: this.fw24.getLayerARN(),
            env: this.getEnvironmentVariables(controllerConfig),
            buckets: controllerConfig?.buckets,
        }).fn;

        // logic for adding dynamodb table access to the controller
        if (controllerConfig?.tableName) {
            // get the dynamodb table based on the controller config
            const tableInstance: TableV2 = this.fw24.getDynamoTable(controllerConfig.tableName);
            // add the table name to the lambda environment
            controllerLambda.addEnvironment(`${controllerConfig.tableName.toUpperCase()}_TABLE`, tableInstance.tableName);
            // grant the lambda function read write access to the table
            tableInstance.grantReadWriteData(controllerLambda);
        }

        // logic for adding s3 bucket access to the controller
        controllerConfig?.buckets?.forEach( ( bucket: any ) => {
            const bucketFullName = this.fw24.getUniqueName(bucket.name);
            const bucketInstance: any = Bucket.fromBucketName(this.mainStack, bucket.name+controllerName+'-bucket', bucketFullName);
            // grant the lambda function access to the bucket
            switch (bucket.access) {
                case 'read':
                    bucketInstance.grantRead(controllerLambda);
                    break;
                case 'write':
                    bucketInstance.grantWrite(controllerLambda);
                    break;
                default:
                    bucketInstance.grantReadWrite(controllerLambda);
                    break;
            }
            // add environment variable for the bucket name
            controllerLambda.addEnvironment(`bucket_${bucket.name}`, bucketFullName);
        });
    
        // create the lambda integration
        const controllerIntegration = new LambdaIntegration(controllerLambda);

        // in case of multiple authorizers in a single application, get the authorizer name
        let authorizerName = undefined;
        if(typeof controllerConfig?.authorizer === 'object') {
            authorizerName = controllerConfig.authorizer.name;
        }
      
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
