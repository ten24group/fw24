import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib'
import { Architecture, Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda'
import { Construct } from 'constructs'


export class CoreLayerStack extends Stack {
    constructor ( scope: Construct, id: string, props?: StackProps ) {
        super( scope, id, props )

        // Create a new Layer Version for the core layer
        const coreLayer = new LayerVersion( this, 'Fw24CoreLayer', {
            layerVersionName: 'Fw24CoreLayer',
            compatibleRuntimes: [
                Runtime.NODEJS_18_X
            ],
            code: Code.fromAsset( './dist/layer' ),
            compatibleArchitectures: [
                Architecture.ARM_64
            ]
        } )

        // Output the ARN of the created Layer Version
        const layerVersionArn = coreLayer.layerVersionArn.split(':').slice(-1)[0]
        new CfnOutput(this, 'Latest Layer Version:', {
            value: layerVersionArn
        });
    }
}