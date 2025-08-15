import { Stack } from "aws-cdk-lib";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { LayerVersionProps } from 'aws-cdk-lib/aws-lambda';
import { IConstructConfig } from "../interfaces/construct-config";
/**
 * Configuration for the PACKAGE_DIRECTORY mode.
 */
export interface IPackageDirectoryConfig extends IConstructConfig {
    /**
     * The name of the layer.
     */
    layerName: string;
    /**
     * The source path of the layer directory.
     */
    sourcePath: string;
    /**
     * The mode of packaging: package the whole directory.
     */
    mode?: 'PACKAGE_DIRECTORY';
    /**
     * Optional properties for the layer version.
     */
    layerProps?: Omit<LayerVersionProps, 'code'>;
}
/**
 * Configuration for the BUILD_AND_PACKAGE mode.
 */
export interface IBuildAndPackageConfig extends IConstructConfig {
    /**
     * The source path of the layer, which can be a directory or a file.
     */
    sourcePath: string;
    /**
     * Optional properties for the layer version.
     */
    layerProps?: Omit<LayerVersionProps, 'code'>;
    /**
     * The mode of packaging: scan and build individual files.
     */
    mode: 'BUILD_AND_PACKAGE';
    /**
     * Optional custom distribution directory for the build outputs.
     */
    distDirectory?: string;
    /**
     * Flag to clear the output directory after packaging; defaults to false.
     */
    clearOutputDir?: boolean;
    /**
     * Configurable output path for the package.
     */
    packagePath?: string;
    notGlobal?: boolean;
}
/**
 * Configuration for layer construct.
 */
export type ILayerConstructConfig = IPackageDirectoryConfig | IBuildAndPackageConfig;
/**
 * Represents a construct for creating Lambda layers.
 */
export declare class LayerConstruct implements FW24Construct {
    private config;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    /**
     * Creates a new LayerConstruct instance.
     * @param config - The configuration for the LayerConstruct.
     *
     * @example
     * ```ts
     * // Detailed usage example.
     * const layerConfig: ILayerConstructConfig[] = [
     *   {
     *     layerName: "MyLayer",
     *     sourcePath: "/path/to/source",
     *     clearOutputDir: true,
     *     layerProps: {
     *       // additional layer properties
     *     }
     *   }, {
     *      sourcePath: "/path/to/layer/file.ts", // File needs to be decorated with `@LayerEntry`
     *      mode: 'BUILD_AND_PACKAGE',
     *  }, {
     *     sourcePath: "/path/to/layers/", // only the files decorated with `@LayerEntry({...})` will be processed as layers
     *     mode: 'BUILD_AND_PACKAGE',
     *     outputDir: "/path/to/dist"
     *     clearOutputDir: true, // defaults to false
     * }
     * ];
     * const layer = new LayerConstruct(layerConfig);
     * ```
     */
    constructor(config: ILayerConstructConfig[]);
    construct(): Promise<void>;
    /**
     * Packages a directory as a Lambda layer.
     * @param layerConfig - The configuration for the layer.
     * @param mainStack - The main stack for deploying resources.
     */
    private packageDirectory;
    /**
     * Scans a directory for TypeScript files and creates Lambda layers for them.
     * @param layerConfig - The configuration for the layer.
     * @param mainStack - The main stack for deploying resources.
     */
    private scanAndPackageFiles;
    /**
     * Attempts to create a Lambda layer for a given TypeScript file.
     * @param file - The path to the TypeScript file.
     * @param distDirectory - The output directory for the build.
     * @param mainStack - The main stack for deploying resources.
     * @param layerConfig - The configuration for the layer.
     */
    private tryCreateLayerForFile;
}
export declare function getLayerProps(target: Function): LayerVersionProps | undefined;
