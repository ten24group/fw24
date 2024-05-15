import { CfnOutput } from "aws-cdk-lib";

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutout, OutputType } from "../interfaces/construct";
import { LogDuration, createLogger } from "../logging";
import { Architecture, Code, LayerVersion, LayerVersionProps, Runtime } from 'aws-cdk-lib/aws-lambda'


export interface ILayerConstructConfig {
    layerName: string;
    layerDirectory: string;
    layerProps?: LayerVersionProps
}

export class LayerConstruct implements FW24Construct {
    readonly logger = createLogger(LayerConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = LayerConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutout;

    constructor(private layerConstructConfig: ILayerConstructConfig[]) {
        Helper.hydrateConfig(layerConstructConfig,'LAYER');
    }

    @LogDuration()
    public async construct() {
        const mainStack = this.fw24.getStack('main');

        this.layerConstructConfig.forEach( ( layerConfig: ILayerConstructConfig ) => {
            this.logger.debug("Creating layer: ", layerConfig.layerName);

            const defaultLayerProps: LayerVersionProps = {
                layerVersionName: layerConfig.layerName,
                compatibleRuntimes: [
                    Runtime.NODEJS_18_X
                ],
                code: Code.fromAsset( layerConfig.layerDirectory ),
                compatibleArchitectures: [
                    Architecture.ARM_64
                ]
            };
            const layer = new LayerVersion(mainStack, layerConfig.layerName + '-layer', {
                ...defaultLayerProps,
                ...layerConfig.layerProps
            });
            this.fw24.setConstructOutput(this, layerConfig.layerName, layer, OutputType.LAYER);

            this.fw24.set(layerConfig.layerName, layer.layerVersionArn, "layer");

            new CfnOutput(mainStack, layerConfig.layerName + 'LayerArn', {
                value: layer.layerVersionArn,
            });
        });
    }
}   