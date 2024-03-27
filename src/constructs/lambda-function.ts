import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Function, Runtime, Architecture, ILayerVersion, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, NodejsFunctionProps, BundlingOptions } from "aws-cdk-lib/aws-lambda-nodejs";

interface LambdaFunctionProps {
  entry: string;
  runtime?: Runtime;
  handler?: string;
  timeout?: Duration;
  memorySize?: number;
  architecture?: Architecture;
  layerArn?: string;
  layers?: ILayerVersion[];
  bundling?: BundlingOptions;
  policies?: any[];
  env?: { [key: string]: string };
  buckets? : [{ name: string, access?: string }];
}

export class LambdaFunction extends Construct {
  readonly fn: Function;

  constructor(scope: Construct, id: string, props: LambdaFunctionProps) {
    super(scope, id);

    let defaultProps: NodejsFunctionProps = {
      runtime: Runtime.NODEJS_18_X,
      architecture: Architecture.ARM_64,
      handler: "handler",
      timeout: Duration.seconds(5),
      memorySize: 128,
    };

    // If layerArn is defined, then we are using the layer
    if(props.layerArn){
      props.layers = [LayerVersion.fromLayerVersionArn(this,  `${id}-Fw24CoreLayer`, props.layerArn)];
      props.bundling = {
        sourceMap: true,
        externalModules: ["aws-sdk", "fw24"],
      };
    }

    this.fn = new NodejsFunction(this, id, { ...defaultProps, ...props });

    // Set environment variables
    if(props.env){
      for (const [key, value] of Object.entries(props.env)) {
        this.fn.addEnvironment(key, value);
      }
    }

    // Attach policies to the function
    if(props.policies){
      props.policies.forEach(policy => {
        this.fn.addToRolePolicy(
          new PolicyStatement(policy)
        );
      });
    }
    
  }
}
