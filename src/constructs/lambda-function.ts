import { Construct } from "constructs";
import { Function, Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { Duration } from "aws-cdk-lib";


export class LambdaFunction extends Construct {
  readonly fn: Function;

  constructor(scope: Construct, id: string, props: NodejsFunctionProps) {
    super(scope, id);

    var defaultProps: NodejsFunctionProps = {
      runtime: Runtime.NODEJS_18_X,
      architecture: Architecture.ARM_64,
      handler: "handler",
      timeout: Duration.seconds(5),
      memorySize: 128,

      // should the layer be here by default?
    };

    this.fn = new NodejsFunction(this, id, { ...defaultProps, ...props });

    //this.fn.addToPolicy();
  }
}
