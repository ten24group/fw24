import { CfnOutput } from "aws-cdk-lib";

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { IStack } from "../interfaces/stack";
import { LogDuration, createLogger } from "../logging";
import { Architecture, Code, LayerVersion, LayerVersionProps, Runtime } from 'aws-cdk-lib/aws-lambda'


export interface ILayerConfig {
    layerName: string;
    layerDirectory: string;
    layerProps?: LayerVersionProps
}

export class LayerStack implements IStack {
    readonly logger = createLogger(LayerStack.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    dependencies: string[] = [];

    constructor(private config: ILayerConfig[]) {
        this.logger.debug("constructor: ", config);
        Helper.hydrateConfig(config,'layer');
    }

    @LogDuration()
    public async construct() {
        const mainStack = this.fw24.getStack('main');

        this.config.forEach( ( layerConfig: ILayerConfig ) => {
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

            this.fw24.set(layerConfig.layerName, layer.layerVersionArn, "layer");

            new CfnOutput(mainStack, layerConfig.layerName + 'LayerArn', {
                value: layer.layerVersionArn,
            });
        });
    }
}   