import { CfnOutput, Stack } from "aws-cdk-lib";

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { DefaultLogger, LogDuration, createLogger, ILogger } from "../logging";
import { Architecture, Code, LayerVersion, LayerVersionProps, Runtime } from 'aws-cdk-lib/aws-lambda';
import { basename as pathBaseName, resolve as pathResolve, join as pathJoin, extname as pathExtname, relative as pathRelative } from 'path';
import { existsSync, mkdirSync, readdirSync, statSync, rmSync, lstatSync, copyFileSync, renameSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { build, BuildOptions } from 'esbuild';
import { LayerEntry } from "../decorators";
import { IConstructConfig } from "../interfaces/construct-config";
import { createHash } from "crypto";
import { merge } from "../utils/merge";


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
     *     external: ['@aws-sdk', 'some-native-module']
     *   }
     * }
     */
    buildOptions?: BuildOptions;

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
    constructor(private config: ILayerConstructConfig[], verboseLog ?: number) {

        if(verboseLog){
            this.logger = createLogger(LayerConstruct.name, 1);
        } else {
            this.logger = createLogger(LayerConstruct.name);
        }
        
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
        // Assign priority to each layer: use explicit priority if set, otherwise use array index + 10
        // Priority 0-9 reserved for framework layers (fw24 core = 0)
        // User layers start at 10+ to ensure framework layers always load first
        this.config.forEach((layerConfig, index) => {
            if (!layerConfig.priority && layerConfig.priority !== 0) {
                layerConfig.priority = index + 10;
            }
        });

        // Process layers in parallel for speed while respecting priority-based loading order
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
            compatibleRuntimes: [ Runtime.NODEJS_22_X ],
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
        // Default to application's dist/layers directory (process.cwd() is the application root)
        const distDirectory = layerConfig.distDirectory || pathJoin(process.cwd(), 'dist/layers');
        const sourceDirectoryOrFileName = pathResolve(layerConfig.sourcePath);
        const tsFiles = lstatSync(sourceDirectoryOrFileName).isDirectory()
            ? scanDirectory(sourceDirectoryOrFileName)
            : [sourceDirectoryOrFileName];

        // Process files in parallel now that we have priority-based ordering
        await Promise.all(tsFiles.map(async (file) => {
            await this.tryCreateLayerForFile(file, distDirectory, layerConfig);
        }));
    }

/**
 * Calculate source hash for cache invalidation
 */
    private calculateLayerSourceHash(file: string, externalPackages: (string | RegExp)[]): string {
        this.logger.info(`Calculating source hash for...`, { file, externalPackages });
        const hash = createHash('sha256');
        
        // Hash source file
        if (existsSync(file)) {
            hash.update(readFileSync(file));
        }
        
        // Hash external packages list
        const pkgNames = externalPackages
            .filter((pkg): pkg is string => typeof pkg === 'string')
            .sort();
        hash.update(JSON.stringify(pkgNames));
        
        // Hash package versions - include ALL dependencies if they exist in package.json
        const projectRoot = pathResolve(process.cwd());
        const projectPkgPath = pathJoin(projectRoot, 'package.json');
        if (existsSync(projectPkgPath)) {
            const projectPkg = JSON.parse(readFileSync(projectPkgPath, 'utf-8'));
            const runtimeDeps = projectPkg.dependencies || {};
            
            // For each dependency, check if it's a local file reference
            // If so, hash the actual directory contents instead of the version string
            Object.keys(runtimeDeps).sort().forEach(pkgName => {
                const version = runtimeDeps[pkgName];
                
                // Check if it's a local file reference (e.g., "file:../fw24", "../fw24", or "/absolute/path")
                const isLocalRef = version.startsWith('file:') || 
                                   version.startsWith('./') || 
                                   version.startsWith('../') ||
                                   version.startsWith('/');
                
                if (isLocalRef) {
                    const pkgPath = pathJoin(projectRoot, 'node_modules', pkgName);
                    if (existsSync(pkgPath)) {
                        this.logger.info(`   → Detecting changes in local package: ${pkgName}`);
                        const dirHash = this.hashDirectory(pkgPath);
                        hash.update(`${pkgName}:${dirHash}`);
                    } else {
                        // Package not installed yet, hash the version string
                        hash.update(`${pkgName}:${version}`);
                    }
                } else {
                    // Regular versioned dependency
                    hash.update(`${pkgName}:${version}`);
                }
            });
        }
        
        return hash.digest('hex');
    }

    /**
     * Hash a directory's contents recursively
     */
    private hashDirectory(dirPath: string): string {
        const hash = createHash('sha256');
        
        const hashDirRecursive = (currentPath: string) => {
            if (!existsSync(currentPath)) return;
            
            const stat = lstatSync(currentPath);
            
            if (stat.isDirectory()) {
                const items = readdirSync(currentPath).sort();
                items.forEach(item => {
                    // Skip node_modules subdirectories to avoid infinite recursion
                    if (item === 'node_modules') return;
                    hashDirRecursive(pathJoin(currentPath, item));
                });
            } else if (stat.isFile()) {
                // Hash file path and contents
                hash.update(currentPath);
                hash.update(readFileSync(currentPath));
            }
        };
        
        hashDirRecursive(dirPath);
        return hash.digest('hex');
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
        constructBuildOptions?: BuildOptions,
        decoratorBuildOptions?: BuildOptions
    ): BuildOptions {
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
        ]) || defaultBuildOptions) as BuildOptions;

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
            const exported = moduleExports[key];
            if (typeof exported === 'function' && isLayerEntry(exported)) {
                return exported;
            }
        });
  
        if(!foundLayerDescriptorName){
            this.logger.warn(`No LayerEntry found in file ${file}. Will use Default options.`);
        }

        LayerEntry({ 
            notGlobal: layerConfig.notGlobal ?? false,
            isEntryPackage: layerConfig.isEntryPackage ?? false
        })
        class EmptyLayerDescriptor {}

        // if no layer descriptor found in the file, create an empty class which will use default options
        const layerDescriptor = foundLayerDescriptorName ? moduleExports[foundLayerDescriptorName] : EmptyLayerDescriptor;

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
        const outputNodejsDir = pathJoin(bundleDir, 'nodejs');
        const hashFile = pathJoin(bundleDir, '.build-hash');

        // ═══════════════════════════════════════════════════════════════
        // OPTIMIZATION: Check if rebuild needed via source hash
        // ═══════════════════════════════════════════════════════════════
        const externalPackages = (buildOptions.external && Array.isArray(buildOptions.external)) ? buildOptions.external : [];
        const currentHash = this.calculateLayerSourceHash(file, externalPackages);
        
        let needsRebuild = true;
        let rebuildReason = 'First build';
        
        if (existsSync(outputNodejsDir) && existsSync(hashFile)) {
            const previousHash = readFileSync(hashFile, 'utf-8').trim();
            if (previousHash === currentHash) {
                needsRebuild = false;
                rebuildReason = 'No source changes detected';
            } else {
                rebuildReason = 'Source code or dependencies changed';
            }
        } else if (existsSync(outputNodejsDir)) {
            rebuildReason = 'Build hash missing (rebuilding for safety)';
        }
        
        if (!needsRebuild) {
            this.logger.info(`[${layerName}] ✓ ${rebuildReason} - using cached build`);
            
            // Still need to register layer with CDK, but skip expensive rebuild
            const layerProps = getLayerProps(layerDescriptor);
            const defaultLayerProps: LayerVersionProps = {
                layerVersionName: layerName,
                compatibleRuntimes: [ Runtime.NODEJS_22_X ],
                code: Code.fromAsset(bundleDir),
                compatibleArchitectures: [Architecture.ARM_64],
            };

            const layer = new LayerVersion(this.mainStack, layerName + '-layer', {
                ...defaultLayerProps,
                ...layerConfig.layerProps,
                ...layerProps,
            });

            this.fw24.setConstructOutput(this, layerName, layer, OutputType.LAYER, 'layerVersionArn');

            // Import path: /opt/nodejs/node_modules/{packageName}/index.js
            // Node.js will resolve this to the bundled entry point
            const layerImportPath = pathJoin('/opt', configuredOutputPath, 'index.js');
            this.fw24.setEnvironmentVariable(layerName, layerImportPath, 'layerImportPath');

            if(isGlobalLayer(layerDescriptor)){
                this.fw24.addGlobalLambdaLayerNames(layerName);
                if (layerConfig.priority === undefined) {
                    throw new Error(`Layer ${layerName} has no priority. This should never happen.`);
                }
                this.fw24.addGlobalLambdaEntryPackage(`env:layerImportPath:${layerName}`, layerConfig.priority);
            }
            
            return; // DONE - saved ~15 seconds!
        }

        // ═══════════════════════════════════════════════════════════════
        // REBUILD NEEDED: Do the expensive work
        // ═══════════════════════════════════════════════════════════════
        this.logger.info(`[${layerName}] Rebuilding: ${rebuildReason}`);
        const buildStartTime = Date.now();

        // Ensure output directory exists
        if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true });
        }

        // Install external dependencies FIRST (so npm install doesn't delete bundled code!)
        if (externalPackages.length > 0) {
            this.logger.info(`[${layerName}] [1/3] Installing external dependencies...`);
            await installExternalDependenciesOptimized(bundleDir, externalPackages, this.logger);
        }

        // Then bundle application code into node_modules
        const outputFile = pathJoin(outputDir, 'index.js');
        this.logger.info(`[${layerName}] [2/3] Bundling with esbuild...`);
        await bundleWithEsbuild(file, outputFile, buildOptions);

        // Save hash for next run
        this.logger.info(`[${layerName}] [3/3] Saving build metadata...`);
        writeFileSync(hashFile, currentHash);
        
        const elapsed = ((Date.now() - buildStartTime) / 1000).toFixed(1);
        this.logger.info(`[${layerName}] ✓ Build complete in ${elapsed}s`)

        // Import path: /opt/nodejs/node_modules/{packageName}/index.js
        // Node.js will resolve this to the bundled entry point
        const layerImportPath = pathJoin('/opt', configuredOutputPath, 'index.js');
        this.logger.info(`[${layerName}] Layer import path: ${layerImportPath}`);

        this.fw24.setEnvironmentVariable(layerName, layerImportPath, 'layerImportPath');

        if(isGlobalLayer(layerDescriptor)){
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

function isEntryPackage(target: Function): boolean {
    const value = Reflect.get(target, 'isEntryPackage');
    // Default to true if not specified
    return value !== false;
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
 * @param buildOptions - Pre-merged build options for esbuild.
 */
async function bundleWithEsbuild(entryFile: string, outputFile: string, buildOptions: BuildOptions) {
    const finalOptions: BuildOptions = {
        ...buildOptions,
        outfile: outputFile,
        entryPoints: [entryFile],
    };

    DefaultLogger.debug(`bundleWithEsbuild: ${entryFile} → ${outputFile}`);
    await build(finalOptions);
}

/**
 * Calculates hash of a file's contents
 */
function calculateFileHash(filePath: string): string {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
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
async function installExternalDependenciesOptimized(layerOutputDir: string, externalPackages: (string | RegExp)[], logger: any) {
    // Filter out regex patterns, framework packages, and packages provided by other layers
    const packageNames = externalPackages.filter(pkg => 
        typeof pkg === 'string' && 
        !pkg.startsWith('@aws-sdk') &&      // Provided by Lambda runtime
        !pkg.startsWith('@smithy') &&       // Provided by Lambda runtime
        !pkg.startsWith('aws-cdk-lib') &&   // Build-time only
        pkg !== 'esbuild' &&                // Build-time only
        pkg !== '@ten24group/fw24'          // Provided by fw24 runtime layer
    ) as string[];

    if (packageNames.length === 0) {
        return;
    }

    const nodejsDir = pathJoin(layerOutputDir, 'nodejs');
    const nodeModulesDir = pathJoin(nodejsDir, 'node_modules');
    const packageJsonPath = pathJoin(nodejsDir, 'package.json');
    const packageHashPath = pathJoin(nodejsDir, '.package-hash');
    
    // Build desired package.json
    const packageJson: any = {
        name: 'layer-dependencies',
        version: '1.0.0',
        dependencies: {}
    };

    // Read the project's package.json to get version numbers
    const projectRoot = pathResolve(process.cwd());
    const projectPackageJsonPath = pathJoin(projectRoot, 'package.json');
    
    if (!existsSync(projectPackageJsonPath)) {
        logger.warn(`package.json not found at ${projectPackageJsonPath}, installing latest versions`);
        packageNames.forEach(pkg => {
            packageJson.dependencies[pkg] = 'latest';
        });
    } else {
        const projectPackageJson = JSON.parse(readFileSync(projectPackageJsonPath, 'utf-8'));
        // ONLY use runtime dependencies - devDependencies are build-time tools, not Lambda runtime!
        const runtimeDeps = projectPackageJson.dependencies || {};

        packageNames.forEach(pkg => {
            if (runtimeDeps[pkg]) {
                let depValue = runtimeDeps[pkg];
                
                // Handle local filesystem dependencies (e.g., "../fw24/" or "file:../fw24")
                if (depValue.startsWith('file:') || depValue.startsWith('../') || depValue.startsWith('./')) {
                    const localPath = depValue.replace('file:', '');
                    // Resolve absolute path of the local package
                    const absolutePath = pathResolve(projectRoot, localPath);
                    
                    if (existsSync(absolutePath)) {
                        // Calculate relative path from nodejsDir to the local package
                        const relativePathFromLayer = pathRelative(nodejsDir, absolutePath);
                        depValue = relativePathFromLayer;
                        logger.info(`   → Resolved local package "${pkg}": ${relativePathFromLayer}`);
                    } else {
                        logger.warn(`⚠️  Local package path not found: ${absolutePath}`);
                    }
                }
                
                packageJson.dependencies[pkg] = depValue;
            } else {
                logger.warn(`⚠️  Package "${pkg}" not found in runtime dependencies`);
                logger.warn(`   Add "${pkg}" to dependencies in package.json or it will use 'latest'`);
                packageJson.dependencies[pkg] = 'latest';
            }
        });
    }

    const packageJsonContent = JSON.stringify(packageJson, null, 2);
    const currentPackageHash = createHash('sha256').update(packageJsonContent).digest('hex');
    
    // ═══════════════════════════════════════════════════════════════
    // FAST PATH: Check if we can skip npm install
    // ═══════════════════════════════════════════════════════════════
    if (existsSync(packageHashPath) && existsSync(nodeModulesDir)) {
        const previousHash = readFileSync(packageHashPath, 'utf-8').trim();
        if (previousHash === currentPackageHash) {
            logger.info(`   ✓ Dependencies already installed, skipping npm install`);
            return; // SAVED 11+ SECONDS!
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // SLOW PATH: Need to run npm install
    // ═══════════════════════════════════════════════════════════════
    logger.info(`   Installing ${packageNames.length} packages: ${packageNames.join(', ')}`);
    
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
        execSync('npm install --omit=dev --no-package-lock --install-links --prefer-offline', {
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
    items.forEach(item => {
        const sourcePath = pathJoin(source, item);
        const targetPath = pathJoin(target, item);
        if (lstatSync(sourcePath).isDirectory()) {
            copyDirectory(sourcePath, targetPath);
        } else {
            copyFileSync(sourcePath, targetPath);
        }
    });
}
