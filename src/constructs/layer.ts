import { CfnOutput, Stack } from "aws-cdk-lib";

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { DefaultLogger, LogDuration, createLogger } from "../logging";
import { Architecture, Code, LayerVersion, LayerVersionProps, Runtime } from 'aws-cdk-lib/aws-lambda';
import { basename as pathBaseName, resolve as pathResolve, join as pathJoin, extname as pathExtname } from 'path';
import { existsSync, mkdirSync, readdirSync, statSync, rmSync, lstatSync, copyFileSync, renameSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { build, BuildOptions } from 'esbuild';
import { LayerEntry } from "../decorators";
import { IConstructConfig } from "../interfaces/construct-config";
import { createHash } from "crypto";


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
     * const layers = new DILayerConstruct([
     *   { sourcePath: './di.ts' },        // priority: 10
     *   { sourcePath: './shared.ts' },    // priority: 11
     *   { sourcePath: './firebase.ts' }   // priority: 12
     * ]);
     * 
     * // Explicit priorities (for special cases):
     * const layers = new DILayerConstruct([
     *   { sourcePath: './di.ts', priority: 10 },      // Load first
     *   { sourcePath: './firebase.ts', priority: 20 }, // Load last
     *   { sourcePath: './shared.ts', priority: 15 }   // Load in between
     * ]);
     */
    priority?: number;
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
     * const layers = new DILayerConstruct([
     *   { sourcePath: './di.ts' },        // priority: 10
     *   { sourcePath: './shared.ts' },    // priority: 11
     *   { sourcePath: './firebase.ts' }   // priority: 12
     * ]);
     * 
     * // Explicit priorities (for special cases):
     * const layers = new DILayerConstruct([
     *   { sourcePath: './di.ts', priority: 10 },      // Load first
     *   { sourcePath: './firebase.ts', priority: 20 }, // Load last
     *   { sourcePath: './shared.ts', priority: 15 }   // Load in between
     * ]);
     */
    priority?: number;
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
    readonly logger = createLogger(LayerConstruct);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name = LayerConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutput;

    mainStack!: Stack;

    /**
     * Creates a new LayerConstruct instance.
     * @param config - The configuration for the LayerConstruct.
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
        const distDirectory = layerConfig.distDirectory || pathJoin(__dirname, '../../dist');
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

        const tempDir = pathJoin(distDirectory, 'layers_temp', layerName);
        const tempOutputDir = pathJoin(tempDir, configuredOutputPath, fileBaseName);
        const tempOutputFile = pathJoin(tempOutputDir, 'index.js');

        // Ensure temp directory exists
        if (!existsSync(tempOutputDir)) {
            mkdirSync(tempOutputDir, { recursive: true });
        }

        // Build to temporary directory first
        await bundleWithEsbuild(file, tempOutputFile, buildOptions);

        // Install external dependencies if specified in buildOptions
        if (buildOptions.external && Array.isArray(buildOptions.external) && buildOptions.external.length > 0) {
            await installExternalDependencies(tempDir, buildOptions.external, this.logger);
        }

        // Move the entire nodejs directory (which contains both bundled code and npm packages)
        const tempNodejsDir = pathJoin(tempDir, 'nodejs');
        const outputNodejsDir = pathJoin(bundleDir, 'nodejs');
        
        // Check if output directory exists and compare contents
        const shouldUpdateOutput = !existsSync(outputNodejsDir) || !areDirectoriesIdentical(tempNodejsDir, outputNodejsDir);

        if (shouldUpdateOutput) {
            this.logger.info(`Content changed for layer ${layerName}, updating output`);
            
            // Clean existing output if it exists
            if (existsSync(outputNodejsDir)) {
                rmSync(outputNodejsDir, { recursive: true });
            }
            
            // Ensure parent directory exists
            if (!existsSync(bundleDir)) {
                mkdirSync(bundleDir, { recursive: true });
            }
            
            // Move entire nodejs directory from temp to output
            renameSync(tempNodejsDir, outputNodejsDir);

        } else {
            this.logger.warn(`No changes detected for layer ${layerName}, keeping existing code`);
        }

        // Clean up the temp directory for this layer
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true });
            this.logger.info(`Cleaned up temp directory for layer ${layerName}`);
        }

        // this is the path that will be used in the layer import statement
        const layerImportPath = pathJoin('/opt', configuredOutputPath, fileBaseName, 'index.js');
        // put it into fw24's config so it can be added to the lambda's environment variables
        this.logger.info('layerImportPath', layerImportPath);

        this.fw24.setEnvironmentVariable(layerName, layerImportPath, 'layerImportPath');

        if(isGlobalLayer(layerDescriptor)){
            // collect global layers for lambda
            this.fw24.addGlobalLambdaLayerNames(layerName);
            // collect global entry-packages for lambdas with priority for correct loading order
            // Priority is always set in construct(), so it must be defined here
            if (layerConfig.priority === undefined) {
                throw new Error(`Layer ${layerName} has no priority. This should never happen.`);
            }
            this.fw24.addGlobalLambdaEntryPackage(`env:layerImportPath:${layerName}`, layerConfig.priority);
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
 * Calculates hash of a file's contents
 */
function calculateFileHash(filePath: string): string {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
}

/**
 * Compare two directories and check if their contents are identical
 */
function areDirectoriesIdentical(dir1: string, dir2: string): boolean {
    if (!existsSync(dir1) || !existsSync(dir2)) return false;

    try {
        const files1 = readdirSync(dir1, { recursive: true }) as string[];
        const files2 = readdirSync(dir2, { recursive: true }) as string[];

        if (files1.length !== files2.length) return false;

        return files1.every(file => {
            const file1Path = pathJoin(dir1, file);
            const file2Path = pathJoin(dir2, file);

            if (!existsSync(file2Path)) return false;
            
            const stat1 = lstatSync(file1Path);
            const stat2 = lstatSync(file2Path);

            if (stat1.isDirectory() !== stat2.isDirectory()) return false;
            if (stat1.isDirectory()) return true;

            return calculateFileHash(file1Path) === calculateFileHash(file2Path);
        });
    } catch (error) {
        return false;
    }
}

/**
 * Move directory contents from source to target
 */
function moveDirectoryContents(sourceDir: string, targetDir: string) {
    if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
    }

    const files = readdirSync(sourceDir, { recursive: true }) as string[];
    files.forEach(file => {
        const sourcePath = pathJoin(sourceDir, file);
        const targetPath = pathJoin(targetDir, file);

        if (lstatSync(sourcePath).isDirectory()) {
            if (!existsSync(targetPath)) {
                mkdirSync(targetPath, { recursive: true });
            }
        } else {
            if (existsSync(targetPath)) {
                rmSync(targetPath);
            }
            renameSync(sourcePath, targetPath);
        }
    });
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
 * Installs external dependencies into the layer's node_modules directory.
 * This is called when buildOptions.external contains packages that should not be bundled.
 * 
 * @param layerTempDir - The temporary directory for the layer (e.g., dist/layers_temp/shared-layer)
 * @param externalPackages - Array of package names to install (e.g., ['axios', 'firebase-admin'])
 * @param logger - Logger instance for output
 */
async function installExternalDependencies(layerTempDir: string, externalPackages: (string | RegExp)[], logger: any) {
    // Filter out regex patterns and framework/built-in modules
    const packageNames = externalPackages.filter(pkg => 
        typeof pkg === 'string' && 
        !pkg.startsWith('@aws-sdk') && 
        !pkg.startsWith('@smithy') &&
        !pkg.startsWith('aws-cdk-lib') &&
        pkg !== 'esbuild' &&
        pkg !== '@ten24group/fw24'
    ) as string[];

    if (packageNames.length === 0) {
        return;
    }

    logger.info(`Installing external dependencies: ${packageNames.join(', ')}`);

    const nodejsDir = pathJoin(layerTempDir, 'nodejs');
    const nodeModulesDir = pathJoin(nodejsDir, 'node_modules');
    
    // Backup bundled code if it exists (npm install will wipe node_modules)
    const bundledCodeBackup = pathJoin(layerTempDir, '_bundled_code_backup');
    if (existsSync(nodeModulesDir)) {
        // Move entire node_modules to backup
        renameSync(nodeModulesDir, bundledCodeBackup);
    }

    // Ensure directories exist for npm install
    if (!existsSync(nodeModulesDir)) {
        mkdirSync(nodeModulesDir, { recursive: true });
    }

    // Create a temporary package.json with only the external dependencies
    const tempPackageJson: any = {
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
            tempPackageJson.dependencies[pkg] = 'latest';
        });
    } else {
        const projectPackageJson = JSON.parse(readFileSync(projectPackageJsonPath, 'utf-8'));
        const allDeps = {
            ...(projectPackageJson.dependencies || {}),
            ...(projectPackageJson.devDependencies || {})
        };

        packageNames.forEach(pkg => {
            if (allDeps[pkg]) {
                tempPackageJson.dependencies[pkg] = allDeps[pkg];
            } else {
                logger.warn(`Package ${pkg} not found in project package.json, using latest`);
                tempPackageJson.dependencies[pkg] = 'latest';
            }
        });
    }

    // Write the temporary package.json
    const tempPackageJsonPath = pathJoin(nodejsDir, 'package.json');
    writeFileSync(tempPackageJsonPath, JSON.stringify(tempPackageJson, null, 2));

    // Install dependencies
    try {
        logger.info(`Running npm install in ${nodejsDir}`);
        execSync('npm install --omit=dev --no-package-lock', {
            cwd: nodejsDir,
            stdio: 'inherit'
        });
        logger.info('External dependencies installed successfully');
    } catch (error) {
        logger.error('Failed to install external dependencies:', error);
        throw error;
    }

    // Remove the temporary package.json (but keep node_modules)
    if (existsSync(tempPackageJsonPath)) {
        rmSync(tempPackageJsonPath);
    }

    // Restore bundled code from backup
    if (existsSync(bundledCodeBackup)) {
        logger.info('Restoring bundled code into node_modules');
        // Copy contents from backup into node_modules
        const backupContents = readdirSync(bundledCodeBackup);
        backupContents.forEach(item => {
            const sourcePath = pathJoin(bundledCodeBackup, item);
            const targetPath = pathJoin(nodeModulesDir, item);
            // Only copy if target doesn't exist (don't overwrite npm-installed packages)
            if (!existsSync(targetPath)) {
                if (lstatSync(sourcePath).isDirectory()) {
                    // Copy directory recursively
                    copyDirectory(sourcePath, targetPath);
                } else {
                    copyFileSync(sourcePath, targetPath);
                }
            }
        });
        // Clean up backup
        rmSync(bundledCodeBackup, { recursive: true });
        logger.info('Bundled code restored successfully');
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
