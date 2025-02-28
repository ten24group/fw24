import { CfnOutput, Stack } from "aws-cdk-lib";

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { DefaultLogger, LogDuration, createLogger } from "../logging";
import { Architecture, Code, LayerVersion, LayerVersionProps, Runtime } from 'aws-cdk-lib/aws-lambda';
import { basename as pathBaseName, resolve as pathResolve, join as pathJoin, extname as pathExtname } from 'path';
import { existsSync, mkdirSync, readdirSync, statSync, rmSync, lstatSync, copyFileSync } from 'fs';
import { build, BuildOptions } from 'esbuild';
import { LayerEntry } from "../decorators";
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
export class LayerConstruct implements FW24Construct {
    readonly logger = createLogger(LayerConstruct);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name = LayerConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutput;

    mainStack!: Stack;

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
    constructor(private config: ILayerConstructConfig[]) {
        
        // add defaults
        config.forEach((layerConfig) => {
            layerConfig.mode = layerConfig.mode || 'PACKAGE_DIRECTORY';
            if (layerConfig.mode === 'BUILD_AND_PACKAGE') {
                layerConfig.clearOutputDir = layerConfig.clearOutputDir ?? false;
            }
        });

        Helper.hydrateConfig(config, 'LAYER');
    }

    @LogDuration()
    public async construct() {
        await Promise.all(this.config.map(async (layerConfig) => {
            this.mainStack = this.fw24.getStack(layerConfig.stackName || this.fw24.getConfig().layerStackName, layerConfig.parentStackName);

            this.logger.debug("Processing layer:", layerConfig);

            if (layerConfig.mode === 'PACKAGE_DIRECTORY') {
                await this.packageDirectory(layerConfig);
            } else if (layerConfig.mode === 'BUILD_AND_PACKAGE') {
                await this.scanAndPackageFiles(layerConfig);
            } else {
                throw new Error(`Invalid mode for layer ${layerConfig}`);
            }
        }));
    }

    /**
     * Packages a directory as a Lambda layer.
     * @param layerConfig - The configuration for the layer.
     * @param mainStack - The main stack for deploying resources.
     */
    private async packageDirectory(layerConfig: IPackageDirectoryConfig) {
        const defaultLayerProps: LayerVersionProps = {
            layerVersionName: layerConfig.layerName,
            compatibleRuntimes: [Runtime.NODEJS_18_X],
            code: Code.fromAsset(layerConfig.sourcePath),
            compatibleArchitectures: [Architecture.ARM_64],
        };
        
        const layer = new LayerVersion(this.mainStack, layerConfig.layerName + '-layer', {
            ...defaultLayerProps,
            ...layerConfig.layerProps,
        });
        
        this.fw24.setConstructOutput(this, layerConfig.layerName, layer, OutputType.LAYER, 'layerVersionArn');

    }

    /**
     * Scans a directory for TypeScript files and creates Lambda layers for them.
     * @param layerConfig - The configuration for the layer.
     * @param mainStack - The main stack for deploying resources.
     */
    private async scanAndPackageFiles(layerConfig: IBuildAndPackageConfig) {
        const distDirectory = layerConfig.distDirectory || pathJoin(__dirname, '../../dist');
        const sourceDirectoryOrFileName = pathResolve(layerConfig.sourcePath);
        const tsFiles = lstatSync(sourceDirectoryOrFileName).isDirectory()
            ? scanDirectory(sourceDirectoryOrFileName)
            : [sourceDirectoryOrFileName];

        await Promise.all(tsFiles.map(async (file) => {
            await this.tryCreateLayerForFile(file, distDirectory, layerConfig);
        }));
    }

    /**
     * Attempts to create a Lambda layer for a given TypeScript file.
     * @param file - The path to the TypeScript file.
     * @param distDirectory - The output directory for the build.
     * @param mainStack - The main stack for deploying resources.
     * @param layerConfig - The configuration for the layer.
     */
    private async tryCreateLayerForFile(file: string, distDirectory: string, layerConfig: IBuildAndPackageConfig) {
        
        const moduleExports = await import(file);

        const foundLayerDescriptorName = Object.keys(moduleExports).find((key) => {
            const exported = moduleExports[key];
            if (typeof exported === 'function' && isLayerEntry(exported)) {
                return exported;
            }
        });
  
        if(!foundLayerDescriptorName){
            this.logger.warn(`No LayerEntry found in file ${file}. Will use Default options.`);
        }

        LayerEntry({ notGlobal: layerConfig.notGlobal ?? false })
        class EmptyLayerDescriptor {}

        // if no layer descriptor found in the file, create an empty class which will use default options
        const layerDescriptor = foundLayerDescriptorName ? moduleExports[foundLayerDescriptorName] : EmptyLayerDescriptor;

        const buildOptions = getLayerBuildOptions(layerDescriptor) || {};

        const fileBaseName = pathBaseName(file, pathExtname(file));
        const layerName = getLayerName(layerDescriptor) || fileBaseName;
        const configuredOutputPath = `nodejs/node_modules/${layerConfig.packagePath ?? ''}` ;
    
        const outputDir = pathJoin(distDirectory, layerName, configuredOutputPath, fileBaseName);
        const bundleDir = pathJoin(distDirectory, layerName);
        const outputFile = pathJoin(outputDir, 'index.js');

        // this is the path that will be used in the layer import statement
        const layerImportPath = pathJoin('/opt', configuredOutputPath, fileBaseName, 'index.js');
        // put it into fw24's config so it can be added to the lambda's environment variables
        this.logger.info('layerImportPath', layerImportPath);

        this.fw24.setEnvironmentVariable(layerName, layerImportPath, 'layerImportPath');

        if(isGlobalLayer(layerDescriptor)){
            // collect global layers for lambda
            this.fw24.addGlobalLambdaLayerNames(layerName);
            // collect global entry-packages for lambdas
            this.fw24.addGlobalLambdaEntryPackage(`env:layerImportPath:${layerName}`);
        }

        const layerProps = getLayerProps(layerDescriptor);

        if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true });
        }

        await bundleWithEsbuild(file, outputFile, buildOptions);

        const defaultLayerProps: LayerVersionProps = {
            layerVersionName: layerName,
            compatibleRuntimes: [Runtime.NODEJS_18_X],
            code: Code.fromAsset(bundleDir),
            compatibleArchitectures: [Architecture.ARM_64],
        };

        const layer = new LayerVersion(this.mainStack, layerName + '-layer', {
            ...defaultLayerProps,
            ...layerConfig.layerProps,
            ...layerProps, // the layerProps from the decorator take precedence
        });

        this.fw24.setConstructOutput(this, layerName, layer, OutputType.LAYER, 'layerVersionArn');

        // Clean up the temporary output directory if configured
        if (layerConfig.clearOutputDir) {
            cleanupDirectory(outputDir);
        }
    }
}

/**
 * Recursively scans a directory and returns a list of TypeScript files.
 * @param directory - The directory to scan.
 * @returns An array of TypeScript file paths.
 */
function scanDirectory(directory: string): string[] {
    let files: string[] = [];
    const items = readdirSync(directory);

    for (const item of items) {
        const fullPath = pathJoin(directory, item);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
            files = files.concat(scanDirectory(fullPath));
        } else if (stat.isFile() && fullPath.endsWith('.ts')) {
            files.push(fullPath);
        }
    }

    return files;
}

function isLayerEntry(target: Function): boolean {
    return !!getLayerName(target);
}

function isGlobalLayer(target: Function): boolean {
    return !Reflect.get(target, 'notGlobal');
}

function getLayerName(target: Function) {
    return Reflect.get(target, 'layerName');
}

function getLayerBuildOptions(target: Function): BuildOptions | undefined {
    return Reflect.get(target, 'buildOptions');
}

export function getLayerProps(target: Function): LayerVersionProps | undefined {
    return Reflect.get(target, 'layerProps');
}

/**
 * Bundles a TypeScript file using esbuild with the provided options.
 * @param entryFile - The entry file to bundle.
 * @param outputFile - The output file path for the bundle.
 * @param buildOptions - The build options for esbuild.
 */
async function bundleWithEsbuild(entryFile: string, outputFile: string, buildOptions: BuildOptions) {
    const defaultOptions: BuildOptions = {
        bundle: true,
        platform: 'node',
        target: 'node18',
        minify: false,
        // keepNames: true, // Keep the names in the minified code for DI-tokens
        sourcemap: true,
        ...buildOptions, // Override with specific build options
        external: [ ...(buildOptions.external || []), 
            // make sure all the dependencies of core-fw layer are marked as external
            '@ten24group/fw24',
            '@aws-sdk',
            '@smithy',
            'aws-cdk-lib',
            'esbuild',
        ], // Specify external packages
        outfile: outputFile,
        entryPoints: [entryFile],
    };

    DefaultLogger.debug(`bundleWithEsbuild: Bundling ${entryFile} into ${outputFile} with options:`, defaultOptions);
    await build(defaultOptions);
}

/**
 * Cleans up a temporary directory by removing all files and subdirectories.
 * @param directory - The directory to clean up.
 */
function cleanupDirectory(directory: string) {
    try {
        rmSync(directory, { recursive: true, force: true });
        DefaultLogger.info(`bundleWithEsbuild: Cleaned up temporary directory: ${directory}`);
    } catch (error) {
        DefaultLogger.error(`bundleWithEsbuild: Failed to clean up directory ${directory}:`, error);
    }
}
