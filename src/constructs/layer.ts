import { CfnOutput } from "aws-cdk-lib";

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { LogDuration, createLogger } from "../logging";
import { Architecture, Code, LayerVersion, LayerVersionProps, Runtime } from 'aws-cdk-lib/aws-lambda'


/**
 * Represents the configuration for a layer construct.
 */
export interface ILayerConstructConfig {
    /**
     * The name of the layer.
     */
    layerName: string;
    
    /**
     * The directory of the layer.
     */
    layerDirectory: string;
    
    /**
     * Optional properties for the layer version.
     */
    layerProps?: Omit<LayerVersionProps, 'code'>;
}

export class LayerConstruct implements FW24Construct {
    readonly logger = createLogger(LayerConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = LayerConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutput;

    /**
     * Creates a new LayerConstruct instance.
     * @param layerConstructConfig - The configuration for the LayerConstruct.
     * 
     * @example
     * ```ts
     * // Detailed usage example
     * const layerConfig: ILayerConstructConfig[] = [
     *   {
     *     layerName: "MyLayer",
     *     layerDirectory: "/path/to/layer",
     *     layerProps: {
     *       // additional layer properties
     *     }
     *   }
     * ];
     * const layer = new LayerConstruct(layerConfig);
     * ```
     */
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