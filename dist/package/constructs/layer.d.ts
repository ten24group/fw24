import { Stack } from "aws-cdk-lib";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { ILogger } from "../logging";
import { LayerVersionProps } from 'aws-cdk-lib/aws-lambda';
import { BuildOptions } from 'esbuild';
import { IConstructConfig } from "../interfaces/construct-config";
/**
 * Extended build options that support separating npm install packages from esbuild externals
 */
export interface ExtendedBuildOptions extends BuildOptions {
    /**
     * Packages to npm install in the layer's node_modules (runtime dependencies).
     * If not provided, falls back to using `external` for backward compatibility.
     *
     * Use this to separate packages that should be npm installed from packages
     * that are provided by other layers (e.g., @ten24group/fw24 from fw24 layer).
     *
     * @example
     * {
     *   external: ['@ten24group/fw24', 'axios'],           // Don't bundle these
     *   externalPackages: ['axios']                        // Only npm install axios
     * }                                                    // fw24 comes from fw24 layer
     */
    externalPackages?: (string | RegExp)[];
}
/**
 * Common layer configuration properties
 */
interface IBaseLayerConfig extends IConstructConfig {
    /**
     * The source path of the layer directory or file.
     */
    sourcePath: string;
    /**
     * Optional properties for the layer version.
     */
    layerProps?: Omit<LayerVersionProps, 'code'>;
    /**
     * Custom build options for esbuild bundling.
     * Merged in priority order: defaults < construct-level < decorator-level
     *
     * @example
     * {
     *   buildOptions: {
     *     sourcemap: true,
     *     minify: false,
     *     external: ['@aws-sdk', '@ten24group/fw24', 'axios'],  // Don't bundle
     *     externalPackages: ['axios']                           // Only npm install axios
     *   }
     * }
     */
    buildOptions?: ExtendedBuildOptions;
    /**
     * Whether this layer should NOT be added as a global layer.
     * If false or undefined, the layer will be automatically attached to all Lambda functions.
     * Defaults to false (layer IS global).
     */
    notGlobal?: boolean;
    /**
     * Whether this layer should be loaded as an entry package (code executes at module initialization).
     * If false, the layer is only available for imports but doesn't execute.
     * Defaults to false.
     *
     * @example
     * // fw24 runtime layer - available for import but doesn't execute
     * { sourcePath: './fw24.js', isEntryPackage: false }
     *
     * // di layer - executes DIContainer.ROOT.module() at init
     * { sourcePath: './di.ts', isEntryPackage: true }
     */
    isEntryPackage?: boolean;
    /**
     * Priority for layer loading order. Lower numbers load first.
     * If not specified, priority is auto-assigned as (array_index + 10).
     *
     * Priority ranges:
     * - 0-9: Reserved for framework layers (fw24 core = 0)
     * - 10+: User/application layers (auto-assigned or explicit)
     *
     * @example
     * // Auto-assigned priorities (recommended):
     * const layers = new LayerConstruct([
     *   { sourcePath: './di.ts' },        // priority: 10
     *   { sourcePath: './shared.ts' },    // priority: 11
     *   { sourcePath: './firebase.ts' }   // priority: 12
     * ]);
     *
     * // Explicit priorities (for special cases):
     * const layers = new LayerConstruct([
     *   { sourcePath: './di.ts', priority: 10 },      // Load first
     *   { sourcePath: './firebase.ts', priority: 20 }, // Load last
     *   { sourcePath: './shared.ts', priority: 15 }   // Load in between
     * ]);
     */
    priority?: number;
}
/**
 * Configuration for the PACKAGE_DIRECTORY mode.
 * Packages a pre-built directory as-is without bundling.
 */
export interface IPackageDirectoryConfig extends IBaseLayerConfig {
    /**
     * The name of the layer.
     */
    layerName: string;
    /**
     * The mode of packaging: package the whole directory.
     */
    mode?: 'PACKAGE_DIRECTORY';
}
/**
 * Configuration for the BUILD_AND_PACKAGE mode.
 * Bundles source files with esbuild before packaging.
 */
export interface IBuildAndPackageConfig extends IBaseLayerConfig {
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
}
/**
 * Configuration for layer construct.
 *
 * Layers are processed in parallel for speed, but loaded at runtime in priority order.
 * Priority determines the order in which layers initialize when Lambda cold starts.
 *
 * @see IBuildAndPackageConfig.priority for priority details
 */
export type ILayerConstructConfig = IPackageDirectoryConfig | IBuildAndPackageConfig;
/**
 * Represents a construct for creating Lambda layers.
 *
 * Layers are built in parallel for performance, but initialize at Lambda runtime
 * in priority order. This ensures correct dependency loading (e.g., DI container
 * loads before layers that use it).
 *
 * Priority System:
 * - 0-9: Reserved for framework layers (fw24 core = 0)
 * - 10+: Application layers (auto-assigned starting at 10, or set explicitly)
 *
 * @example
 * ```ts
 * // Basic usage with auto-priority (recommended)
 * const diLayer = new DILayerConstruct([
 *   { sourcePath: './src/di.ts' },              // priority: 10 (auto)
 *   { sourcePath: './src/config/shared.ts' },   // priority: 11 (auto)
 *   { sourcePath: './src/config/firebase.ts' }  // priority: 12 (auto)
 * ]);
 *
 * // Advanced usage with explicit priorities
 * const diLayer = new DILayerConstruct([
 *   { sourcePath: './src/di.ts', priority: 10 },        // Load first
 *   { sourcePath: './src/config/firebase.ts', priority: 20 }, // Load last
 *   { sourcePath: './src/config/shared.ts', priority: 15 }    // Load in between
 * ]);
 * ```
 */
export declare class LayerConstruct implements FW24Construct {
    private readonly config;
    readonly logger: ILogger;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    /**
     * Creates a new LayerConstruct instance.
     * @param config - The configuration for the LayerConstruct.
     */
    constructor(config: ILayerConstructConfig[], verboseLog?: number);
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
     * Merges build options with proper priority: defaults < construct-level < decorator-level
     * @param layerName - Layer name for logging
     * @param constructBuildOptions - Build options from construct config
     * @param decoratorBuildOptions - Build options from @LayerEntry decorator
     * @returns Merged build options
     */
    private mergeBuildOptions;
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
export {};
