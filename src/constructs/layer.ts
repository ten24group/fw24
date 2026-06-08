import { Stack } from "aws-cdk-lib";

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { DefaultLogger, LogDuration, createLogger, ILogger } from "../logging";
import { Timer } from "../utils/timer";
import { Architecture, Code, LayerVersion, LayerVersionProps, Runtime } from 'aws-cdk-lib/aws-lambda';
import { basename as pathBaseName, resolve as pathResolve, join as pathJoin, extname as pathExtname, relative as pathRelative } from 'node:path';
import { existsSync, mkdirSync, readdirSync, statSync, rmSync, lstatSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { build, BuildOptions } from 'esbuild';
import { LayerEntry } from "../decorators";
import { IConstructConfig } from "../interfaces/construct-config";
import { createHash } from "node:crypto";
import { merge } from "../utils/merge";

interface IPackageJson {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
}

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
export class LayerConstruct implements FW24Construct {
    readonly logger: ILogger;
    readonly fw24: Fw24 = Fw24.getInstance();

    name = LayerConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutput;

    mainStack!: Stack;

    /**
     * Creates a new LayerConstruct instance.
     * @param config - The configuration for the LayerConstruct.
     */
    constructor(private readonly config: ILayerConstructConfig[], verboseLog?: number) {

        if (verboseLog) {
            this.logger = createLogger(LayerConstruct.name, 1);
        } else {
            this.logger = createLogger(LayerConstruct.name);
        }

        // add defaults
        for (const layerConfig of config) {
            layerConfig.mode = layerConfig.mode || 'PACKAGE_DIRECTORY';
            if (layerConfig.mode === 'BUILD_AND_PACKAGE') {
                layerConfig.clearOutputDir = layerConfig.clearOutputDir ?? false;
            }
        }

        Helper.hydrateConfig(config, 'LAYER');
    }

    @LogDuration()
    public async construct() {
        // Assign priority to each layer: use explicit priority if set, otherwise use array index + 10
        // Priority 0-9 reserved for framework layers (fw24 core = 0)
        // User layers start at 10+ to ensure framework layers always load first
        for (const [ index, layerConfig ] of this.config.entries()) {
            if (!layerConfig.priority && layerConfig.priority !== 0) {
                layerConfig.priority = index + 10;
            }
        }

        // Process layers in parallel for speed while respecting priority-based loading order
        await Promise.all(this.config.map(async (layerConfig) => {
            this.mainStack = this.fw24.getStack(layerConfig.stackName || this.fw24.getConfig().layerStackName, layerConfig.parentStackName);

            this.logger.debug("Processing layer:", layerConfig);

            if (layerConfig.mode === 'PACKAGE_DIRECTORY') {
                await this.packageDirectory(layerConfig);
            } else if (layerConfig.mode === 'BUILD_AND_PACKAGE') {
                await this.scanAndPackageFiles(layerConfig);
            } else {
                throw new Error(`Invalid mode for layer ${JSON.stringify(layerConfig)}`);
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
            compatibleRuntimes: [ Runtime.NODEJS_22_X ],
            code: Code.fromAsset(layerConfig.sourcePath),
            compatibleArchitectures: [ Architecture.ARM_64 ],
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
        // Default to application's dist/layers directory (process.cwd() is the application root)
        const distDirectory = layerConfig.distDirectory || pathJoin(process.cwd(), 'dist/layers');
        const sourceDirectoryOrFileName = pathResolve(layerConfig.sourcePath);
        const tsFiles = lstatSync(sourceDirectoryOrFileName).isDirectory()
            ? scanDirectory(sourceDirectoryOrFileName)
            : [ sourceDirectoryOrFileName ];

        // Process files in parallel now that we have priority-based ordering
        await Promise.all(tsFiles.map(async (file) => {
            await this.tryCreateLayerForFile(file, distDirectory, layerConfig);
        }));
    }


    /**
     * Merges build options with proper priority: defaults < construct-level < decorator-level
     * @param layerName - Layer name for logging
     * @param constructBuildOptions - Build options from construct config
     * @param decoratorBuildOptions - Build options from @LayerEntry decorator
     * @returns Merged build options
     */
    private mergeBuildOptions(
        layerName: string,
        constructBuildOptions?: ExtendedBuildOptions,
        decoratorBuildOptions?: ExtendedBuildOptions
    ): ExtendedBuildOptions {
        // Default build options for all layers
        const defaultBuildOptions: BuildOptions = {
            bundle: true,
            platform: 'node',
            target: 'node18',
            minify: false,
            sourcemap: false,
            external: [
                // Framework runtime provided by separate fw24 layer
                '@ten24group/fw24',
                // AWS SDK and build tools
                '@aws-sdk',
                '@smithy',
                'aws-cdk-lib',
                'esbuild',
            ]
        };

        // Merge in priority order using deep merge
        const merged = (merge([
            defaultBuildOptions,
            constructBuildOptions || {},
            decoratorBuildOptions || {}
        ]) ?? defaultBuildOptions);

        // Log merged configuration
        this.logger.debug(`[${layerName}] Build options merged:`, {
            sourcemap: merged.sourcemap,
            minify: merged.minify,
            external: merged.external,
            platform: merged.platform,
            target: merged.target
        });

        return merged;
    }

    /**
     * Attempts to create a Lambda layer for a given TypeScript file.
     * @param file - The path to the TypeScript file.
     * @param distDirectory - The output directory for the build.
     * @param mainStack - The main stack for deploying resources.
     * @param layerConfig - The configuration for the layer.
     */
    private async tryCreateLayerForFile(file: string, distDirectory: string, layerConfig: IBuildAndPackageConfig) {
        const fileBaseName = pathBaseName(file, pathExtname(file));
        this.logger.info(`Processing layer: ${fileBaseName}`);

        this.logger.debug(`Loading layer descriptor from ${file}...`);
        const moduleExports = await import(file);
        this.logger.debug(`Layer descriptor loaded`);

        const foundLayerDescriptorName = Object.keys(moduleExports).find((key) => {
            const exported = moduleExports[ key ];
            if (typeof exported === 'function' && isLayerEntry(exported)) {
                return exported;
            }
        });

        if (!foundLayerDescriptorName) {
            this.logger.warn(`No LayerEntry found in file ${file}. Will use Default options.`);
        }

        LayerEntry({
            notGlobal: layerConfig.notGlobal ?? false,
            isEntryPackage: layerConfig.isEntryPackage ?? false
        })
        class EmptyLayerDescriptor { }

        // if no layer descriptor found in the file, create an empty class which will use default options
        const layerDescriptor = foundLayerDescriptorName ? moduleExports[ foundLayerDescriptorName ] : EmptyLayerDescriptor;

        const layerName = getLayerName(layerDescriptor) || fileBaseName;

        // Merge build options: defaults < construct-level < decorator-level
        const decoratorBuildOptions = getLayerBuildOptions(layerDescriptor);
        const buildOptions = this.mergeBuildOptions(
            layerName,
            layerConfig.buildOptions,
            decoratorBuildOptions
        );

        // Determine package structure:
        // - If packagePath is set: use it as the full module path (e.g., @ten24group/fw24)
        // - If not set: use fileBaseName as the package name (e.g., di, shared)
        const packageName = layerConfig.packagePath || fileBaseName;
        const configuredOutputPath = `nodejs/node_modules/${packageName}`;

        const outputDir = pathJoin(distDirectory, layerName, configuredOutputPath);
        const bundleDir = pathJoin(distDirectory, layerName);

        // ═══════════════════════════════════════════════════════════════
        // BUILD LAYER: esbuild + npm install (with npm install caching)
        // ═══════════════════════════════════════════════════════════════
        this.logger.info(`[${layerName}] Building layer...`);
        const buildTimer = Timer.start();

        // Ensure output directory exists
        if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true });
        }

        // Install external dependencies FIRST (with smart caching to skip if unchanged)
        // Use buildOptions.externalPackages if provided, otherwise fall back to buildOptions.external for backward compatibility
        // This allows separating packages to npm install from packages to mark as external in esbuild
        const externalPackages = buildOptions.externalPackages
            ? (Array.isArray(buildOptions.externalPackages) ? buildOptions.externalPackages : [])
            : (buildOptions.external && Array.isArray(buildOptions.external)) ? buildOptions.external : [];

        if (externalPackages.length > 0) {
            const installTimer = Timer.start();
            this.logger.info(`[${layerName}] [1/2] Installing external dependencies...`);
            await installExternalDependenciesOptimized(bundleDir, externalPackages, this.logger);
            this.logger.info(`[${layerName}]    ✓ Dependencies installed (${installTimer.elapsedSeconds()})`);
        }

        // Then bundle application code into node_modules
        const outputFile = pathJoin(outputDir, 'index.js');
        const bundleTimer = Timer.start();
        this.logger.info(`[${layerName}] [2/2] Bundling with esbuild...`);
        await bundleWithEsbuild(file, outputFile, buildOptions);
        this.logger.info(`[${layerName}]    ✓ Bundle complete (${bundleTimer.elapsedSeconds()})`);

        // Create package.json for Node.js module resolution
        // Without this, require('@package/name') won't work even if index.js exists
        const packageJsonPath = pathJoin(outputDir, 'package.json');
        const packageJson = {
            name: packageName,
            version: "1.0.0",
            main: "index.js",
            type: "commonjs"
        };
        writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        this.logger.info(`[${layerName}]    ✓ Created package.json for module resolution`);

        this.logger.info(`[${layerName}] ✓ Build complete in ${buildTimer.elapsedSeconds()}`)

        // Import path: /opt/nodejs/node_modules/{packageName}/index.js
        // Node.js will resolve this to the bundled entry point
        const layerImportPath = pathJoin('/opt', configuredOutputPath, 'index.js');
        this.logger.info(`[${layerName}] Layer import path: ${layerImportPath}`);

        this.fw24.setEnvironmentVariable(layerName, layerImportPath, 'layerImportPath');

        if (isGlobalLayer(layerDescriptor)) {
            // Attach this layer to all Lambda functions
            this.fw24.addGlobalLambdaLayerNames(layerName);

            // Only add as entry package if it needs to execute at module initialization
            if (isEntryPackage(layerDescriptor)) {
                // collect global entry-packages for lambdas with priority for correct loading order
                // Priority is always set in construct(), so it must be defined here
                if (layerConfig.priority === undefined) {
                    throw new Error(`Layer ${layerName} has no priority. This should never happen.`);
                }
                this.fw24.addGlobalLambdaEntryPackage(`env:layerImportPath:${layerName}`, layerConfig.priority);
                this.logger.info(`[${layerName}] Registered as entry package (priority: ${layerConfig.priority})`);
            } else {
                this.logger.info(`[${layerName}] Layer attached but NOT an entry package (available for import only)`);
            }
        }

        const layerProps = getLayerProps(layerDescriptor);

        const defaultLayerProps: LayerVersionProps = {
            layerVersionName: layerName,
            compatibleRuntimes: [ Runtime.NODEJS_22_X ],
            code: Code.fromAsset(bundleDir),
            compatibleArchitectures: [ Architecture.ARM_64 ],
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

function isEntryPackage(target: Function): boolean {
    const value = Reflect.get(target, 'isEntryPackage');
    // Default to FALSE - layers are NOT entry packages unless explicitly marked
    // Entry packages execute code at Lambda init; most layers are just runtime libraries
    return value === true;
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
 * Build options should already be merged via mergeBuildOptions().
 * @param entryFile - The entry file to bundle.
 * @param outputFile - The output file path for the bundle.
 * @param buildOptions - Pre-merged build options (may include custom fields like externalPackages).
 */
async function bundleWithEsbuild(entryFile: string, outputFile: string, buildOptions: ExtendedBuildOptions) {
    // Strip out custom fields that esbuild doesn't recognize
    const { externalPackages: _externalPackages, ...esbuildOptions } = buildOptions;

    const finalOptions: BuildOptions = {
        ...esbuildOptions,
        outfile: outputFile,
        entryPoints: [ entryFile ],
    };

    DefaultLogger.debug(`bundleWithEsbuild: ${entryFile} → ${outputFile}`);

    try {
        await build(finalOptions);
    } catch (error) {
        DefaultLogger.error(`Failed to bundle ${entryFile}:`, error);
        throw new Error(`esbuild failed for ${entryFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Calculates hash of a file's contents
 */
function calculateFileHash(filePath: string): string {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
}

/**
 * Hashes a directory's contents recursively for change detection
 * Used for local package dependencies to detect when they've been rebuilt
 * @param dirPath - Directory to hash (typically a dist folder)
 * @returns SHA-256 hash of all file contents
 */
/**
 * Recursively hashes the contents of a directory for change detection.
 * Skips common non-runtime directories (node_modules, .git, test, etc.)
 * Returns consistent SHA-256 hash even for empty directories.
 * 
 * @param dirPath - Absolute path to directory to hash
 * @returns SHA-256 hash (64 hex characters)
 */
function hashDirectoryContents(dirPath: string): string {
    const hash = createHash('sha256');
    let fileCount = 0;

    const hashDirRecursive = (currentPath: string) => {
        if (!existsSync(currentPath)) return;

        const stat = lstatSync(currentPath);

        if (stat.isSymbolicLink()) {
            // Skip symlinks to avoid infinite loops and inconsistent behavior
            return;
        }

        if (stat.isDirectory()) {
            const items = readdirSync(currentPath).sort((a, b) => a.localeCompare(b)); // Sort for deterministic hashing
            for (const item of items) {
                // Skip common directories that don't affect runtime
                if (item === 'node_modules' || item === '.git' ||
                    item === 'test' || item === '__tests__' ||
                    item === 'coverage' || item === '.DS_Store') {
                    return;
                }
                hashDirRecursive(pathJoin(currentPath, item));
            }
        } else if (stat.isFile()) {
            fileCount++;
            // Hash file path (relative) for uniqueness
            const relativePath = pathRelative(dirPath, currentPath);
            hash.update(relativePath);
            // Hash file contents
            hash.update(readFileSync(currentPath));
        }
    };

    // Hash the directory path itself first for uniqueness
    hash.update(dirPath);
    hashDirRecursive(dirPath);

    // If no files were found, update hash with sentinel value
    // This ensures empty directories have a different hash than non-existent ones
    if (fileCount === 0) {
        hash.update('__EMPTY_DIRECTORY__');
    }

    return hash.digest('hex');
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

/**
 * OPTIMIZED: Installs external dependencies with intelligent caching
 * 
 * @param layerOutputDir - The OUTPUT directory for the layer (e.g., dist/layers/di)
 * @param externalPackages - Array of package names to install (e.g., ['axios', 'firebase-admin'])
 * @param logger - Logger instance for output
 */
async function installExternalDependenciesOptimized(layerOutputDir: string, externalPackages: (string | RegExp)[], logger: ILogger) {
    // Filter out regex patterns, framework packages, and packages provided by other layers
    const packageNames = externalPackages.filter(pkg =>
        typeof pkg === 'string' &&
        !pkg.startsWith('@aws-sdk') &&      // Provided by Lambda runtime
        !pkg.startsWith('@smithy') &&       // Provided by Lambda runtime
        !pkg.startsWith('aws-cdk-lib') &&   // Build-time only
        pkg !== 'esbuild' &&                // Build-time only
        pkg !== '@ten24group/fw24'          // Provided by fw24 runtime layer (not di layer)
    ) as string[];

    if (packageNames.length === 0) {
        return;
    }

    const nodejsDir = pathJoin(layerOutputDir, 'nodejs');
    const nodeModulesDir = pathJoin(nodejsDir, 'node_modules');
    const packageJsonPath = pathJoin(nodejsDir, 'package.json');
    const packageHashPath = pathJoin(nodejsDir, '.package-hash');

    // Build desired package.json
    const packageJson: IPackageJson = {
        name: 'layer-dependencies',
        version: '1.0.0',
        dependencies: {}
    };

    // Read the project's package.json to get version numbers
    const projectRoot = pathResolve(process.cwd());
    const projectPackageJsonPath = pathJoin(projectRoot, 'package.json');

    // Track local package content hashes for change detection
    const localPackageHashes: Record<string, string> = {};

    if (!existsSync(projectPackageJsonPath)) {
        logger.warn(`package.json not found at ${projectPackageJsonPath}, installing latest versions`);
        if (!packageJson.dependencies) {
            packageJson.dependencies = {};
        }
        for (const pkg of packageNames) {
            packageJson.dependencies[ pkg ] = 'latest';
        }
    } else {
        const projectPackageJson = JSON.parse(readFileSync(projectPackageJsonPath, 'utf-8'));
        // ONLY use runtime dependencies - devDependencies are build-time tools, not Lambda runtime!
        const runtimeDeps = projectPackageJson.dependencies || {};

        for (const pkg of packageNames) {
            if (runtimeDeps[ pkg ]) {
                let depValue = runtimeDeps[ pkg ];

                // Handle local filesystem dependencies (e.g., "../fw24/", "file:../fw24", or "..\fw24" on Windows)
                const isLocalDep = depValue.startsWith('file:') ||
                    depValue.startsWith('../') ||
                    depValue.startsWith('./') ||
                    depValue.startsWith('..\\') ||
                    depValue.startsWith('.\\');

                if (isLocalDep) {
                    const localPath = depValue.replace('file:', '');
                    // Resolve absolute path of the local package
                    const absolutePath = pathResolve(projectRoot, localPath);

                    // Validate local package exists
                    if (!existsSync(absolutePath)) {
                        const errorMsg = [
                            `❌ Local package "${pkg}" path does not exist: ${absolutePath}`,
                            `   Specified in package.json as: ${depValue}`,
                            `   Resolved from project root: ${projectRoot}`,
                            `   Please ensure the local package path is correct.`
                        ].join('\n');
                        logger.error(errorMsg);
                        throw new Error(`Local package path not found: ${pkg} -> ${absolutePath}`);
                    }

                    // CRITICAL: Validate that local package is built (has dist folder)
                    const distPath = pathJoin(absolutePath, 'dist');
                    if (!existsSync(distPath)) {
                        const errorMsg = [
                            `❌ Local package "${pkg}" has no dist folder: ${distPath}`,
                            `   Local packages MUST be built before being used as dependencies.`,
                            `   Please run the build command in: ${absolutePath}`,
                            `   Example: cd ${absolutePath} && npm run build`
                        ].join('\n');
                        logger.error(errorMsg);
                        throw new Error(`Local package not built: ${pkg} (missing dist folder)`);
                    }

                    // Hash the dist folder contents for change detection
                    logger.info(`   → Hashing local package "${pkg}" dist folder...`);
                    const contentHash = hashDirectoryContents(distPath);

                    // Validate hash is non-empty (dist folder has actual files)
                    if (contentHash?.length !== 64) {
                        logger.warn(`   ⚠️  Unexpected hash for "${pkg}": ${contentHash}`);
                    }

                    localPackageHashes[ pkg ] = contentHash;
                    logger.info(`   → Local package "${pkg}" hash: ${contentHash.substring(0, 12)}... (${pkg})`);

                    // Calculate relative path from layer's nodejs dir to local package
                    const relativePathFromLayer = pathRelative(nodejsDir, absolutePath);
                    depValue = relativePathFromLayer;
                    logger.info(`   → Resolved local package "${pkg}": ${relativePathFromLayer}`);
                }

                if (!packageJson.dependencies) {
                    packageJson.dependencies = {};
                }
                packageJson.dependencies[ pkg ] = depValue;
            } else {
                // Package not found in dependencies - this is a configuration error
                const errorMsg = [
                    `❌ Package "${pkg}" not found in runtime dependencies.`,
                    `   This package is marked as 'external' in the layer build but is not in package.json dependencies.`,
                    `   Add "${pkg}" to dependencies in package.json with a specific version.`,
                    `   Example: npm install ${pkg} --save`,
                    `   Then rebuild the layer.`
                ].join('\n');

                logger.error(errorMsg);
                throw new Error(`Missing runtime dependency: ${pkg}`);
            }
        };
    }

    const packageJsonContent = JSON.stringify(packageJson, null, 2);
    const hash = createHash('sha256');
    hash.update(packageJsonContent);

    // CRITICAL: Include local package content hashes in the cache key
    // This ensures we reinstall when local packages change (e.g., fw24 updates)
    if (Object.keys(localPackageHashes).length > 0) {
        logger.debug(`   → Including ${Object.keys(localPackageHashes).length} local package content hashes in cache key`);
        for (const pkg of Object.keys(localPackageHashes).sort((a, b) => a.localeCompare(b))) {
            hash.update(`${pkg}:${localPackageHashes[ pkg ]}`);
        }
    }

    const currentPackageHash = hash.digest('hex');

    // ═══════════════════════════════════════════════════════════════
    // FAST PATH: Check if we can skip npm install
    // ═══════════════════════════════════════════════════════════════
    let skipReason: string | null = null;
    if (!existsSync(packageHashPath)) {
        skipReason = 'No previous hash file found (first build)';
    } else if (!existsSync(nodeModulesDir)) {
        skipReason = 'node_modules directory not found';
    } else {
        try {
            const previousHash = readFileSync(packageHashPath, 'utf-8').trim();
            // Validate hash format (SHA-256 = 64 hex chars)
            if (previousHash.length !== 64 || !/^[0-9a-f]{64}$/.test(previousHash)) {
                skipReason = `Invalid hash format in cache file (got ${previousHash.length} chars)`;
            } else if (previousHash === currentPackageHash) {
                logger.info(`   ✓ Dependencies unchanged, skipping npm install (saved ~11s)`);
                return; // FAST PATH SUCCESS!
            } else {
                skipReason = 'Dependency changes detected';
                logger.info(`   → Previous hash: ${previousHash.substring(0, 12)}...`);
                logger.info(`   → Current hash:  ${currentPackageHash.substring(0, 12)}...`);
                if (Object.keys(localPackageHashes).length > 0) {
                    logger.info(`   → Local packages included in hash: ${Object.keys(localPackageHashes).join(', ')}`);
                }
            }
        } catch (error: unknown) {
            skipReason = `Failed to read hash file: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SLOW PATH: Need to run npm install
    // ═══════════════════════════════════════════════════════════════
    logger.info(`   📦 Running npm install (reason: ${skipReason})`);
    logger.info(`   → Installing ${packageNames.length} package(s): ${packageNames.join(', ')}`);

    const installStartTime = Date.now();

    // Ensure directory exists
    if (!existsSync(nodejsDir)) {
        mkdirSync(nodejsDir, { recursive: true });
    }

    // Write package.json
    writeFileSync(packageJsonPath, packageJsonContent);

    // Install dependencies
    try {
        // --install-links is needed to install local packages from file: references
        // --prefer-offline is needed to speed up the installation
        // --no-package-lock is needed to avoid package-lock.json conflicts
        // --omit=dev is needed to avoid installing dev dependencies
        // --legacy-peer-deps is needed to skip peer dependencies (e.g., @ten24group/fw24 from fw24-auth-cognito)
        execSync('npm install --omit=dev --no-package-lock --install-links --prefer-offline --legacy-peer-deps', {
            cwd: nodejsDir,
            stdio: 'inherit'
        });

        const elapsed = ((Date.now() - installStartTime) / 1000).toFixed(1);
        logger.info(`   ✓ npm install complete in ${elapsed}s`);

        // Save hash for next run
        writeFileSync(packageHashPath, currentPackageHash);

    } catch (error) {
        logger.error('Failed to install external dependencies:', error);
        throw error;
    }
}

/**
 * Recursively copy a directory
 */
function copyDirectory(source: string, target: string) {
    if (!existsSync(target)) {
        mkdirSync(target, { recursive: true });
    }
    const items = readdirSync(source);
    for (const item of items) {
        const sourcePath = pathJoin(source, item);
        const targetPath = pathJoin(target, item);
        if (lstatSync(sourcePath).isDirectory()) {
            copyDirectory(sourcePath, targetPath);
        } else {
            copyFileSync(sourcePath, targetPath);
        }
    }
}
