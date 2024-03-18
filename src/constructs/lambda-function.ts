import { Construct } from "constructs";
import { Function, Runtime, Architecture, ILayerVersion, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, NodejsFunctionProps, BundlingOptions } from "aws-cdk-lib/aws-lambda-nodejs";
import { Duration } from "aws-cdk-lib";

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
      delete props.layerArn;
    }

    this.fn = new NodejsFunction(this, id, { ...defaultProps, ...props });

    //this.fn.addToPolicy();
  }
}
