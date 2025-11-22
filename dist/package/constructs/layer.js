"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LayerConstruct = void 0;
exports.getLayerProps = getLayerProps;
const helper_1 = require("../core/helper");
const fw24_1 = require("../core/fw24");
const construct_1 = require("../interfaces/construct");
const logging_1 = require("../logging");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const path_1 = require("path");
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const esbuild_1 = require("esbuild");
const decorators_1 = require("../decorators");
const crypto_1 = require("crypto");
const merge_1 = require("../utils/merge");
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
class LayerConstruct {
    config;
    logger;
    fw24 = fw24_1.Fw24.getInstance();
    name = LayerConstruct.name;
    dependencies = [];
    output;
    mainStack;
    /**
     * Creates a new LayerConstruct instance.
     * @param config - The configuration for the LayerConstruct.
     */
    constructor(config, verboseLog) {
        this.config = config;
        if (verboseLog) {
            this.logger = (0, logging_1.createLogger)(LayerConstruct.name, 1);
        }
        else {
            this.logger = (0, logging_1.createLogger)(LayerConstruct.name);
        }
        // add defaults
        config.forEach((layerConfig) => {
            layerConfig.mode = layerConfig.mode || 'PACKAGE_DIRECTORY';
            if (layerConfig.mode === 'BUILD_AND_PACKAGE') {
                layerConfig.clearOutputDir = layerConfig.clearOutputDir ?? false;
            }
        });
        helper_1.Helper.hydrateConfig(config, 'LAYER');
    }
    async construct() {
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
            }
            else if (layerConfig.mode === 'BUILD_AND_PACKAGE') {
                await this.scanAndPackageFiles(layerConfig);
            }
            else {
                throw new Error(`Invalid mode for layer ${layerConfig}`);
            }
        }));
    }
    /**
     * Packages a directory as a Lambda layer.
     * @param layerConfig - The configuration for the layer.
     * @param mainStack - The main stack for deploying resources.
     */
    async packageDirectory(layerConfig) {
        const defaultLayerProps = {
            layerVersionName: layerConfig.layerName,
            compatibleRuntimes: [aws_lambda_1.Runtime.NODEJS_22_X],
            code: aws_lambda_1.Code.fromAsset(layerConfig.sourcePath),
            compatibleArchitectures: [aws_lambda_1.Architecture.ARM_64],
        };
        const layer = new aws_lambda_1.LayerVersion(this.mainStack, layerConfig.layerName + '-layer', {
            ...defaultLayerProps,
            ...layerConfig.layerProps,
        });
        this.fw24.setConstructOutput(this, layerConfig.layerName, layer, construct_1.OutputType.LAYER, 'layerVersionArn');
    }
    /**
     * Scans a directory for TypeScript files and creates Lambda layers for them.
     * @param layerConfig - The configuration for the layer.
     * @param mainStack - The main stack for deploying resources.
     */
    async scanAndPackageFiles(layerConfig) {
        // Default to application's dist/layers directory (process.cwd() is the application root)
        const distDirectory = layerConfig.distDirectory || (0, path_1.join)(process.cwd(), 'dist/layers');
        const sourceDirectoryOrFileName = (0, path_1.resolve)(layerConfig.sourcePath);
        const tsFiles = (0, fs_1.lstatSync)(sourceDirectoryOrFileName).isDirectory()
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
    calculateLayerSourceHash(file, externalPackages) {
        this.logger.info(`Calculating source hash for...`, { file, externalPackages });
        const hash = (0, crypto_1.createHash)('sha256');
        // Hash source file
        if ((0, fs_1.existsSync)(file)) {
            hash.update((0, fs_1.readFileSync)(file));
        }
        // Hash external packages list
        const pkgNames = externalPackages
            .filter((pkg) => typeof pkg === 'string')
            .sort();
        hash.update(JSON.stringify(pkgNames));
        // Hash package versions - include ALL dependencies if they exist in package.json
        const projectRoot = (0, path_1.resolve)(process.cwd());
        const projectPkgPath = (0, path_1.join)(projectRoot, 'package.json');
        if ((0, fs_1.existsSync)(projectPkgPath)) {
            const projectPkg = JSON.parse((0, fs_1.readFileSync)(projectPkgPath, 'utf-8'));
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
                    const pkgPath = (0, path_1.join)(projectRoot, 'node_modules', pkgName);
                    if ((0, fs_1.existsSync)(pkgPath)) {
                        this.logger.info(`   → Detecting changes in local package: ${pkgName}`);
                        const dirHash = this.hashDirectory(pkgPath);
                        hash.update(`${pkgName}:${dirHash}`);
                    }
                    else {
                        // Package not installed yet, hash the version string
                        hash.update(`${pkgName}:${version}`);
                    }
                }
                else {
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
    hashDirectory(dirPath) {
        const hash = (0, crypto_1.createHash)('sha256');
        const hashDirRecursive = (currentPath) => {
            if (!(0, fs_1.existsSync)(currentPath))
                return;
            const stat = (0, fs_1.lstatSync)(currentPath);
            if (stat.isDirectory()) {
                const items = (0, fs_1.readdirSync)(currentPath).sort();
                items.forEach(item => {
                    // Skip node_modules subdirectories to avoid infinite recursion
                    if (item === 'node_modules')
                        return;
                    hashDirRecursive((0, path_1.join)(currentPath, item));
                });
            }
            else if (stat.isFile()) {
                // Hash file path and contents
                hash.update(currentPath);
                hash.update((0, fs_1.readFileSync)(currentPath));
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
    mergeBuildOptions(layerName, constructBuildOptions, decoratorBuildOptions) {
        // Default build options for all layers
        const defaultBuildOptions = {
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
        const merged = ((0, merge_1.merge)([
            defaultBuildOptions,
            constructBuildOptions || {},
            decoratorBuildOptions || {}
        ]) || defaultBuildOptions);
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
    async tryCreateLayerForFile(file, distDirectory, layerConfig) {
        const fileBaseName = (0, path_1.basename)(file, (0, path_1.extname)(file));
        this.logger.info(`Processing layer: ${fileBaseName}`);
        this.logger.debug(`Loading layer descriptor from ${file}...`);
        const moduleExports = await Promise.resolve(`${file}`).then(s => __importStar(require(s)));
        this.logger.debug(`Layer descriptor loaded`);
        const foundLayerDescriptorName = Object.keys(moduleExports).find((key) => {
            const exported = moduleExports[key];
            if (typeof exported === 'function' && isLayerEntry(exported)) {
                return exported;
            }
        });
        if (!foundLayerDescriptorName) {
            this.logger.warn(`No LayerEntry found in file ${file}. Will use Default options.`);
        }
        (0, decorators_1.LayerEntry)({
            notGlobal: layerConfig.notGlobal ?? false,
            isEntryPackage: layerConfig.isEntryPackage ?? false
        });
        class EmptyLayerDescriptor {
        }
        // if no layer descriptor found in the file, create an empty class which will use default options
        const layerDescriptor = foundLayerDescriptorName ? moduleExports[foundLayerDescriptorName] : EmptyLayerDescriptor;
        const layerName = getLayerName(layerDescriptor) || fileBaseName;
        // Merge build options: defaults < construct-level < decorator-level
        const decoratorBuildOptions = getLayerBuildOptions(layerDescriptor);
        const buildOptions = this.mergeBuildOptions(layerName, layerConfig.buildOptions, decoratorBuildOptions);
        // Determine package structure:
        // - If packagePath is set: use it as the full module path (e.g., @ten24group/fw24)
        // - If not set: use fileBaseName as the package name (e.g., di, shared)
        const packageName = layerConfig.packagePath || fileBaseName;
        const configuredOutputPath = `nodejs/node_modules/${packageName}`;
        const outputDir = (0, path_1.join)(distDirectory, layerName, configuredOutputPath);
        const bundleDir = (0, path_1.join)(distDirectory, layerName);
        const outputNodejsDir = (0, path_1.join)(bundleDir, 'nodejs');
        const hashFile = (0, path_1.join)(bundleDir, '.build-hash');
        // ═══════════════════════════════════════════════════════════════
        // OPTIMIZATION: Check if rebuild needed via source hash
        // ═══════════════════════════════════════════════════════════════
        const externalPackages = (buildOptions.external && Array.isArray(buildOptions.external)) ? buildOptions.external : [];
        const currentHash = this.calculateLayerSourceHash(file, externalPackages);
        let needsRebuild = true;
        let rebuildReason = 'First build';
        if ((0, fs_1.existsSync)(outputNodejsDir) && (0, fs_1.existsSync)(hashFile)) {
            const previousHash = (0, fs_1.readFileSync)(hashFile, 'utf-8').trim();
            if (previousHash === currentHash) {
                needsRebuild = false;
                rebuildReason = 'No source changes detected';
            }
            else {
                rebuildReason = 'Source code or dependencies changed';
            }
        }
        else if ((0, fs_1.existsSync)(outputNodejsDir)) {
            rebuildReason = 'Build hash missing (rebuilding for safety)';
        }
        if (!needsRebuild) {
            this.logger.info(`[${layerName}] ✓ ${rebuildReason} - using cached build`);
            // Still need to register layer with CDK, but skip expensive rebuild
            const layerProps = getLayerProps(layerDescriptor);
            const defaultLayerProps = {
                layerVersionName: layerName,
                compatibleRuntimes: [aws_lambda_1.Runtime.NODEJS_22_X],
                code: aws_lambda_1.Code.fromAsset(bundleDir),
                compatibleArchitectures: [aws_lambda_1.Architecture.ARM_64],
            };
            const layer = new aws_lambda_1.LayerVersion(this.mainStack, layerName + '-layer', {
                ...defaultLayerProps,
                ...layerConfig.layerProps,
                ...layerProps,
            });
            this.fw24.setConstructOutput(this, layerName, layer, construct_1.OutputType.LAYER, 'layerVersionArn');
            // Import path: /opt/nodejs/node_modules/{packageName}/index.js
            // Node.js will resolve this to the bundled entry point
            const layerImportPath = (0, path_1.join)('/opt', configuredOutputPath, 'index.js');
            this.fw24.setEnvironmentVariable(layerName, layerImportPath, 'layerImportPath');
            if (isGlobalLayer(layerDescriptor)) {
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
        if (!(0, fs_1.existsSync)(outputDir)) {
            (0, fs_1.mkdirSync)(outputDir, { recursive: true });
        }
        // Install external dependencies FIRST (so npm install doesn't delete bundled code!)
        if (externalPackages.length > 0) {
            this.logger.info(`[${layerName}] [1/3] Installing external dependencies...`);
            await installExternalDependenciesOptimized(bundleDir, externalPackages, this.logger);
        }
        // Then bundle application code into node_modules
        const outputFile = (0, path_1.join)(outputDir, 'index.js');
        this.logger.info(`[${layerName}] [2/3] Bundling with esbuild...`);
        await bundleWithEsbuild(file, outputFile, buildOptions);
        // Save hash for next run
        this.logger.info(`[${layerName}] [3/3] Saving build metadata...`);
        (0, fs_1.writeFileSync)(hashFile, currentHash);
        const elapsed = ((Date.now() - buildStartTime) / 1000).toFixed(1);
        this.logger.info(`[${layerName}] ✓ Build complete in ${elapsed}s`);
        // Import path: /opt/nodejs/node_modules/{packageName}/index.js
        // Node.js will resolve this to the bundled entry point
        const layerImportPath = (0, path_1.join)('/opt', configuredOutputPath, 'index.js');
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
            }
            else {
                this.logger.info(`[${layerName}] Layer attached but NOT an entry package (available for import only)`);
            }
        }
        const layerProps = getLayerProps(layerDescriptor);
        const defaultLayerProps = {
            layerVersionName: layerName,
            compatibleRuntimes: [aws_lambda_1.Runtime.NODEJS_22_X],
            code: aws_lambda_1.Code.fromAsset(bundleDir),
            compatibleArchitectures: [aws_lambda_1.Architecture.ARM_64],
        };
        const layer = new aws_lambda_1.LayerVersion(this.mainStack, layerName + '-layer', {
            ...defaultLayerProps,
            ...layerConfig.layerProps,
            ...layerProps, // the layerProps from the decorator take precedence
        });
        this.fw24.setConstructOutput(this, layerName, layer, construct_1.OutputType.LAYER, 'layerVersionArn');
        // Clean up the temporary output directory if configured
        if (layerConfig.clearOutputDir) {
            cleanupDirectory(outputDir);
        }
    }
}
exports.LayerConstruct = LayerConstruct;
__decorate([
    (0, logging_1.LogDuration)()
], LayerConstruct.prototype, "construct", null);
/**
 * Recursively scans a directory and returns a list of TypeScript files.
 * @param directory - The directory to scan.
 * @returns An array of TypeScript file paths.
 */
function scanDirectory(directory) {
    let files = [];
    const items = (0, fs_1.readdirSync)(directory);
    for (const item of items) {
        const fullPath = (0, path_1.join)(directory, item);
        const stat = (0, fs_1.statSync)(fullPath);
        if (stat.isDirectory()) {
            files = files.concat(scanDirectory(fullPath));
        }
        else if (stat.isFile() && fullPath.endsWith('.ts')) {
            files.push(fullPath);
        }
    }
    return files;
}
function isLayerEntry(target) {
    return !!getLayerName(target);
}
function isGlobalLayer(target) {
    return !Reflect.get(target, 'notGlobal');
}
function isEntryPackage(target) {
    const value = Reflect.get(target, 'isEntryPackage');
    // Default to true if not specified
    return value !== false;
}
function getLayerName(target) {
    return Reflect.get(target, 'layerName');
}
function getLayerBuildOptions(target) {
    return Reflect.get(target, 'buildOptions');
}
function getLayerProps(target) {
    return Reflect.get(target, 'layerProps');
}
/**
 * Bundles a TypeScript file using esbuild with the provided options.
 * Build options should already be merged via mergeBuildOptions().
 * @param entryFile - The entry file to bundle.
 * @param outputFile - The output file path for the bundle.
 * @param buildOptions - Pre-merged build options for esbuild.
 */
async function bundleWithEsbuild(entryFile, outputFile, buildOptions) {
    const finalOptions = {
        ...buildOptions,
        outfile: outputFile,
        entryPoints: [entryFile],
    };
    logging_1.DefaultLogger.debug(`bundleWithEsbuild: ${entryFile} → ${outputFile}`);
    await (0, esbuild_1.build)(finalOptions);
}
/**
 * Calculates hash of a file's contents
 */
function calculateFileHash(filePath) {
    const content = (0, fs_1.readFileSync)(filePath);
    return (0, crypto_1.createHash)('sha256').update(content).digest('hex');
}
/**
 * Cleans up a temporary directory by removing all files and subdirectories.
 * @param directory - The directory to clean up.
 */
function cleanupDirectory(directory) {
    try {
        (0, fs_1.rmSync)(directory, { recursive: true, force: true });
        logging_1.DefaultLogger.info(`bundleWithEsbuild: Cleaned up temporary directory: ${directory}`);
    }
    catch (error) {
        logging_1.DefaultLogger.error(`bundleWithEsbuild: Failed to clean up directory ${directory}:`, error);
    }
}
/**
 * OPTIMIZED: Installs external dependencies with intelligent caching
 *
 * @param layerOutputDir - The OUTPUT directory for the layer (e.g., dist/layers/di)
 * @param externalPackages - Array of package names to install (e.g., ['axios', 'firebase-admin'])
 * @param logger - Logger instance for output
 */
async function installExternalDependenciesOptimized(layerOutputDir, externalPackages, logger) {
    // Filter out regex patterns, framework packages, and packages provided by other layers
    const packageNames = externalPackages.filter(pkg => typeof pkg === 'string' &&
        !pkg.startsWith('@aws-sdk') && // Provided by Lambda runtime
        !pkg.startsWith('@smithy') && // Provided by Lambda runtime
        !pkg.startsWith('aws-cdk-lib') && // Build-time only
        pkg !== 'esbuild' && // Build-time only
        pkg !== '@ten24group/fw24' // Provided by fw24 runtime layer
    );
    if (packageNames.length === 0) {
        return;
    }
    const nodejsDir = (0, path_1.join)(layerOutputDir, 'nodejs');
    const nodeModulesDir = (0, path_1.join)(nodejsDir, 'node_modules');
    const packageJsonPath = (0, path_1.join)(nodejsDir, 'package.json');
    const packageHashPath = (0, path_1.join)(nodejsDir, '.package-hash');
    // Build desired package.json
    const packageJson = {
        name: 'layer-dependencies',
        version: '1.0.0',
        dependencies: {}
    };
    // Read the project's package.json to get version numbers
    const projectRoot = (0, path_1.resolve)(process.cwd());
    const projectPackageJsonPath = (0, path_1.join)(projectRoot, 'package.json');
    if (!(0, fs_1.existsSync)(projectPackageJsonPath)) {
        logger.warn(`package.json not found at ${projectPackageJsonPath}, installing latest versions`);
        packageNames.forEach(pkg => {
            packageJson.dependencies[pkg] = 'latest';
        });
    }
    else {
        const projectPackageJson = JSON.parse((0, fs_1.readFileSync)(projectPackageJsonPath, 'utf-8'));
        // ONLY use runtime dependencies - devDependencies are build-time tools, not Lambda runtime!
        const runtimeDeps = projectPackageJson.dependencies || {};
        packageNames.forEach(pkg => {
            if (runtimeDeps[pkg]) {
                let depValue = runtimeDeps[pkg];
                // Handle local filesystem dependencies (e.g., "../fw24/" or "file:../fw24")
                if (depValue.startsWith('file:') || depValue.startsWith('../') || depValue.startsWith('./')) {
                    const localPath = depValue.replace('file:', '');
                    // Resolve absolute path of the local package
                    const absolutePath = (0, path_1.resolve)(projectRoot, localPath);
                    if ((0, fs_1.existsSync)(absolutePath)) {
                        // Calculate relative path from nodejsDir to the local package
                        const relativePathFromLayer = (0, path_1.relative)(nodejsDir, absolutePath);
                        depValue = relativePathFromLayer;
                        logger.info(`   → Resolved local package "${pkg}": ${relativePathFromLayer}`);
                    }
                    else {
                        logger.warn(`⚠️  Local package path not found: ${absolutePath}`);
                    }
                }
                packageJson.dependencies[pkg] = depValue;
            }
            else {
                logger.warn(`⚠️  Package "${pkg}" not found in runtime dependencies`);
                logger.warn(`   Add "${pkg}" to dependencies in package.json or it will use 'latest'`);
                packageJson.dependencies[pkg] = 'latest';
            }
        });
    }
    const packageJsonContent = JSON.stringify(packageJson, null, 2);
    const currentPackageHash = (0, crypto_1.createHash)('sha256').update(packageJsonContent).digest('hex');
    // ═══════════════════════════════════════════════════════════════
    // FAST PATH: Check if we can skip npm install
    // ═══════════════════════════════════════════════════════════════
    if ((0, fs_1.existsSync)(packageHashPath) && (0, fs_1.existsSync)(nodeModulesDir)) {
        const previousHash = (0, fs_1.readFileSync)(packageHashPath, 'utf-8').trim();
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
    if (!(0, fs_1.existsSync)(nodejsDir)) {
        (0, fs_1.mkdirSync)(nodejsDir, { recursive: true });
    }
    // Write package.json
    (0, fs_1.writeFileSync)(packageJsonPath, packageJsonContent);
    // Install dependencies
    try {
        // --install-links is needed to install local packages from file: references
        // --prefer-offline is needed to speed up the installation
        // --no-package-lock is needed to avoid package-lock.json conflicts
        // --omit=dev is needed to avoid installing dev dependencies
        (0, child_process_1.execSync)('npm install --omit=dev --no-package-lock --install-links --prefer-offline', {
            cwd: nodejsDir,
            stdio: 'inherit'
        });
        const elapsed = ((Date.now() - installStartTime) / 1000).toFixed(1);
        logger.info(`   ✓ npm install complete in ${elapsed}s`);
        // Save hash for next run
        (0, fs_1.writeFileSync)(packageHashPath, currentPackageHash);
    }
    catch (error) {
        logger.error('Failed to install external dependencies:', error);
        throw error;
    }
}
/**
 * Recursively copy a directory
 */
function copyDirectory(source, target) {
    if (!(0, fs_1.existsSync)(target)) {
        (0, fs_1.mkdirSync)(target, { recursive: true });
    }
    const items = (0, fs_1.readdirSync)(source);
    items.forEach(item => {
        const sourcePath = (0, path_1.join)(source, item);
        const targetPath = (0, path_1.join)(target, item);
        if ((0, fs_1.lstatSync)(sourcePath).isDirectory()) {
            copyDirectory(sourcePath, targetPath);
        }
        else {
            (0, fs_1.copyFileSync)(sourcePath, targetPath);
        }
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGF5ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9sYXllci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFxb0JBLHNDQUVDO0FBcm9CRCwyQ0FBd0M7QUFDeEMsdUNBQW9DO0FBQ3BDLHVEQUF5RjtBQUN6Rix3Q0FBK0U7QUFDL0UsdURBQXNHO0FBQ3RHLCtCQUE0STtBQUM1SSwyQkFBNEk7QUFDNUksaURBQXlDO0FBQ3pDLHFDQUE4QztBQUM5Qyw4Q0FBMkM7QUFFM0MsbUNBQW9DO0FBQ3BDLDBDQUF1QztBQW1JdkM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTJCRztBQUNILE1BQWEsY0FBYztJQWNIO0lBYlgsTUFBTSxDQUFVO0lBQ2hCLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUM7SUFDM0IsWUFBWSxHQUFhLEVBQUUsQ0FBQztJQUM1QixNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUVsQjs7O09BR0c7SUFDSCxZQUFvQixNQUErQixFQUFFLFVBQW9CO1FBQXJELFdBQU0sR0FBTixNQUFNLENBQXlCO1FBRS9DLElBQUcsVUFBVSxFQUFDLENBQUM7WUFDWCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxjQUFjLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ3ZELENBQUM7YUFBTSxDQUFDO1lBQ0osSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3BELENBQUM7UUFFRCxlQUFlO1FBQ2YsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFO1lBQzNCLFdBQVcsQ0FBQyxJQUFJLEdBQUcsV0FBVyxDQUFDLElB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QUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNiLE1BQU0sQ0FBQyxLQUFLLENBQUMsMENBQTBDLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDaEUsTUFBTSxLQUFLLENBQUM7SUFDaEIsQ0FBQztBQUNMLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsYUFBYSxDQUFDLE1BQWMsRUFBRSxNQUFjO0lBQ2pELElBQUksQ0FBQyxJQUFBLGVBQVUsRUFBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1FBQ3RCLElBQUEsY0FBUyxFQUFDLE1BQU0sRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0lBQzNDLENBQUM7SUFDRCxNQUFNLEtBQUssR0FBRyxJQUFBLGdCQUFXLEVBQUMsTUFBTSxDQUFDLENBQUM7SUFDbEMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUNqQixNQUFNLFVBQVUsR0FBRyxJQUFBLFdBQVEsRUFBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDMUMsTUFBTSxVQUFVLEdBQUcsSUFBQSxXQUFRLEVBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzFDLElBQUksSUFBQSxjQUFTLEVBQUMsVUFBVSxDQUFDLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUN0QyxhQUFhLENBQUMsVUFBVSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQzFDLENBQUM7YUFBTSxDQUFDO1lBQ0osSUFBQSxpQkFBWSxFQUFDLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUN6QyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2ZuT3V0cHV0LCBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuXG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0LCBGVzI0Q29uc3RydWN0T3V0cHV0LCBPdXRwdXRUeXBlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBEZWZhdWx0TG9nZ2VyLCBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyLCBJTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IEFyY2hpdGVjdHVyZSwgQ29kZSwgTGF5ZXJWZXJzaW9uLCBMYXllclZlcnNpb25Qcm9wcywgUnVudGltZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgYmFzZW5hbWUgYXMgcGF0aEJhc2VOYW1lLCByZXNvbHZlIGFzIHBhdGhSZXNvbHZlLCBqb2luIGFzIHBhdGhKb2luLCBleHRuYW1lIGFzIHBhdGhFeHRuYW1lLCByZWxhdGl2ZSBhcyBwYXRoUmVsYXRpdmUgfSBmcm9tICdwYXRoJztcbmltcG9ydCB7IGV4aXN0c1N5bmMsIG1rZGlyU3luYywgcmVhZGRpclN5bmMsIHN0YXRTeW5jLCBybVN5bmMsIGxzdGF0U3luYywgY29weUZpbGVTeW5jLCByZW5hbWVTeW5jLCByZWFkRmlsZVN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tICdmcyc7XG5pbXBvcnQgeyBleGVjU3luYyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgYnVpbGQsIEJ1aWxkT3B0aW9ucyB9IGZyb20gJ2VzYnVpbGQnO1xuaW1wb3J0IHsgTGF5ZXJFbnRyeSB9IGZyb20gXCIuLi9kZWNvcmF0b3JzXCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gXCJjcnlwdG9cIjtcbmltcG9ydCB7IG1lcmdlIH0gZnJvbSBcIi4uL3V0aWxzL21lcmdlXCI7XG5cblxuLyoqXG4gKiBDb21tb24gbGF5ZXIgY29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzXG4gKi9cbmludGVyZmFjZSBJQmFzZUxheWVyQ29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIHNvdXJjZSBwYXRoIG9mIHRoZSBsYXllciBkaXJlY3Rvcnkgb3IgZmlsZS5cbiAgICAgKi9cbiAgICBzb3VyY2VQYXRoOiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBwcm9wZXJ0aWVzIGZvciB0aGUgbGF5ZXIgdmVyc2lvbi5cbiAgICAgKi9cbiAgICBsYXllclByb3BzPzogT21pdDxMYXllclZlcnNpb25Qcm9wcywgJ2NvZGUnPjtcblxuICAgIC8qKlxuICAgICAqIEN1c3RvbSBidWlsZCBvcHRpb25zIGZvciBlc2J1aWxkIGJ1bmRsaW5nLlxuICAgICAqIE1lcmdlZCBpbiBwcmlvcml0eSBvcmRlcjogZGVmYXVsdHMgPCBjb25zdHJ1Y3QtbGV2ZWwgPCBkZWNvcmF0b3ItbGV2ZWxcbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHtcbiAgICAgKiAgIGJ1aWxkT3B0aW9uczoge1xuICAgICAqICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICogICAgIG1pbmlmeTogZmFsc2UsXG4gICAgICogICAgIGV4dGVybmFsOiBbJ0Bhd3Mtc2RrJywgJ3NvbWUtbmF0aXZlLW1vZHVsZSddXG4gICAgICogICB9XG4gICAgICogfVxuICAgICAqL1xuICAgIGJ1aWxkT3B0aW9ucz86IEJ1aWxkT3B0aW9ucztcblxuICAgIC8qKlxuICAgICAqIFdoZXRoZXIgdGhpcyBsYXllciBzaG91bGQgTk9UIGJlIGFkZGVkIGFzIGEgZ2xvYmFsIGxheWVyLlxuICAgICAqIElmIGZhbHNlIG9yIHVuZGVmaW5lZCwgdGhlIGxheWVyIHdpbGwgYmUgYXV0b21hdGljYWxseSBhdHRhY2hlZCB0byBhbGwgTGFtYmRhIGZ1bmN0aW9ucy5cbiAgICAgKiBEZWZhdWx0cyB0byBmYWxzZSAobGF5ZXIgSVMgZ2xvYmFsKS5cbiAgICAgKi9cbiAgICBub3RHbG9iYWw/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogV2hldGhlciB0aGlzIGxheWVyIHNob3VsZCBiZSBsb2FkZWQgYXMgYW4gZW50cnkgcGFja2FnZSAoY29kZSBleGVjdXRlcyBhdCBtb2R1bGUgaW5pdGlhbGl6YXRpb24pLlxuICAgICAqIElmIGZhbHNlLCB0aGUgbGF5ZXIgaXMgb25seSBhdmFpbGFibGUgZm9yIGltcG9ydHMgYnV0IGRvZXNuJ3QgZXhlY3V0ZS5cbiAgICAgKiBEZWZhdWx0cyB0byBmYWxzZS5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIC8vIGZ3MjQgcnVudGltZSBsYXllciAtIGF2YWlsYWJsZSBmb3IgaW1wb3J0IGJ1dCBkb2Vzbid0IGV4ZWN1dGVcbiAgICAgKiB7IHNvdXJjZVBhdGg6ICcuL2Z3MjQuanMnLCBpc0VudHJ5UGFja2FnZTogZmFsc2UgfVxuICAgICAqIFxuICAgICAqIC8vIGRpIGxheWVyIC0gZXhlY3V0ZXMgRElDb250YWluZXIuUk9PVC5tb2R1bGUoKSBhdCBpbml0XG4gICAgICogeyBzb3VyY2VQYXRoOiAnLi9kaS50cycsIGlzRW50cnlQYWNrYWdlOiB0cnVlIH1cbiAgICAgKi9cbiAgICBpc0VudHJ5UGFja2FnZT86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBQcmlvcml0eSBmb3IgbGF5ZXIgbG9hZGluZyBvcmRlci4gTG93ZXIgbnVtYmVycyBsb2FkIGZpcnN0LlxuICAgICAqIElmIG5vdCBzcGVjaWZpZWQsIHByaW9yaXR5IGlzIGF1dG8tYXNzaWduZWQgYXMgKGFycmF5X2luZGV4ICsgMTApLlxuICAgICAqIFxuICAgICAqIFByaW9yaXR5IHJhbmdlczpcbiAgICAgKiAtIDAtOTogUmVzZXJ2ZWQgZm9yIGZyYW1ld29yayBsYXllcnMgKGZ3MjQgY29yZSA9IDApXG4gICAgICogLSAxMCs6IFVzZXIvYXBwbGljYXRpb24gbGF5ZXJzIChhdXRvLWFzc2lnbmVkIG9yIGV4cGxpY2l0KVxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogLy8gQXV0by1hc3NpZ25lZCBwcmlvcml0aWVzIChyZWNvbW1lbmRlZCk6XG4gICAgICogY29uc3QgbGF5ZXJzID0gbmV3IExheWVyQ29uc3RydWN0KFtcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vZGkudHMnIH0sICAgICAgICAvLyBwcmlvcml0eTogMTBcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vc2hhcmVkLnRzJyB9LCAgICAvLyBwcmlvcml0eTogMTFcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vZmlyZWJhc2UudHMnIH0gICAvLyBwcmlvcml0eTogMTJcbiAgICAgKiBdKTtcbiAgICAgKiBcbiAgICAgKiAvLyBFeHBsaWNpdCBwcmlvcml0aWVzIChmb3Igc3BlY2lhbCBjYXNlcyk6XG4gICAgICogY29uc3QgbGF5ZXJzID0gbmV3IExheWVyQ29uc3RydWN0KFtcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vZGkudHMnLCBwcmlvcml0eTogMTAgfSwgICAgICAvLyBMb2FkIGZpcnN0XG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2ZpcmViYXNlLnRzJywgcHJpb3JpdHk6IDIwIH0sIC8vIExvYWQgbGFzdFxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9zaGFyZWQudHMnLCBwcmlvcml0eTogMTUgfSAgIC8vIExvYWQgaW4gYmV0d2VlblxuICAgICAqIF0pO1xuICAgICAqL1xuICAgIHByaW9yaXR5PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIHRoZSBQQUNLQUdFX0RJUkVDVE9SWSBtb2RlLlxuICogUGFja2FnZXMgYSBwcmUtYnVpbHQgZGlyZWN0b3J5IGFzLWlzIHdpdGhvdXQgYnVuZGxpbmcuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVBhY2thZ2VEaXJlY3RvcnlDb25maWcgZXh0ZW5kcyBJQmFzZUxheWVyQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgbmFtZSBvZiB0aGUgbGF5ZXIuXG4gICAgICovXG4gICAgbGF5ZXJOYW1lOiBzdHJpbmc7XG4gICAgXG4gICAgLyoqXG4gICAgICogVGhlIG1vZGUgb2YgcGFja2FnaW5nOiBwYWNrYWdlIHRoZSB3aG9sZSBkaXJlY3RvcnkuXG4gICAgICovXG4gICAgbW9kZT86ICdQQUNLQUdFX0RJUkVDVE9SWSc7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIEJVSUxEX0FORF9QQUNLQUdFIG1vZGUuXG4gKiBCdW5kbGVzIHNvdXJjZSBmaWxlcyB3aXRoIGVzYnVpbGQgYmVmb3JlIHBhY2thZ2luZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnIGV4dGVuZHMgSUJhc2VMYXllckNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIG1vZGUgb2YgcGFja2FnaW5nOiBzY2FuIGFuZCBidWlsZCBpbmRpdmlkdWFsIGZpbGVzLlxuICAgICAqL1xuICAgIG1vZGU6ICdCVUlMRF9BTkRfUEFDS0FHRSc7XG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBjdXN0b20gZGlzdHJpYnV0aW9uIGRpcmVjdG9yeSBmb3IgdGhlIGJ1aWxkIG91dHB1dHMuXG4gICAgICovXG4gICAgZGlzdERpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIEZsYWcgdG8gY2xlYXIgdGhlIG91dHB1dCBkaXJlY3RvcnkgYWZ0ZXIgcGFja2FnaW5nOyBkZWZhdWx0cyB0byBmYWxzZS5cbiAgICAgKi9cbiAgICBjbGVhck91dHB1dERpcj86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBDb25maWd1cmFibGUgb3V0cHV0IHBhdGggZm9yIHRoZSBwYWNrYWdlLlxuICAgICAqLyBcbiAgICBwYWNrYWdlUGF0aD86IHN0cmluZztcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBsYXllciBjb25zdHJ1Y3QuXG4gKiBcbiAqIExheWVycyBhcmUgcHJvY2Vzc2VkIGluIHBhcmFsbGVsIGZvciBzcGVlZCwgYnV0IGxvYWRlZCBhdCBydW50aW1lIGluIHByaW9yaXR5IG9yZGVyLlxuICogUHJpb3JpdHkgZGV0ZXJtaW5lcyB0aGUgb3JkZXIgaW4gd2hpY2ggbGF5ZXJzIGluaXRpYWxpemUgd2hlbiBMYW1iZGEgY29sZCBzdGFydHMuXG4gKiBcbiAqIEBzZWUgSUJ1aWxkQW5kUGFja2FnZUNvbmZpZy5wcmlvcml0eSBmb3IgcHJpb3JpdHkgZGV0YWlsc1xuICovXG5leHBvcnQgdHlwZSBJTGF5ZXJDb25zdHJ1Y3RDb25maWcgPSBJUGFja2FnZURpcmVjdG9yeUNvbmZpZyB8IElCdWlsZEFuZFBhY2thZ2VDb25maWc7XG5cbi8qKlxuICogUmVwcmVzZW50cyBhIGNvbnN0cnVjdCBmb3IgY3JlYXRpbmcgTGFtYmRhIGxheWVycy5cbiAqIFxuICogTGF5ZXJzIGFyZSBidWlsdCBpbiBwYXJhbGxlbCBmb3IgcGVyZm9ybWFuY2UsIGJ1dCBpbml0aWFsaXplIGF0IExhbWJkYSBydW50aW1lXG4gKiBpbiBwcmlvcml0eSBvcmRlci4gVGhpcyBlbnN1cmVzIGNvcnJlY3QgZGVwZW5kZW5jeSBsb2FkaW5nIChlLmcuLCBESSBjb250YWluZXJcbiAqIGxvYWRzIGJlZm9yZSBsYXllcnMgdGhhdCB1c2UgaXQpLlxuICogXG4gKiBQcmlvcml0eSBTeXN0ZW06XG4gKiAtIDAtOTogUmVzZXJ2ZWQgZm9yIGZyYW1ld29yayBsYXllcnMgKGZ3MjQgY29yZSA9IDApXG4gKiAtIDEwKzogQXBwbGljYXRpb24gbGF5ZXJzIChhdXRvLWFzc2lnbmVkIHN0YXJ0aW5nIGF0IDEwLCBvciBzZXQgZXhwbGljaXRseSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiAvLyBCYXNpYyB1c2FnZSB3aXRoIGF1dG8tcHJpb3JpdHkgKHJlY29tbWVuZGVkKVxuICogY29uc3QgZGlMYXllciA9IG5ldyBESUxheWVyQ29uc3RydWN0KFtcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvZGkudHMnIH0sICAgICAgICAgICAgICAvLyBwcmlvcml0eTogMTAgKGF1dG8pXG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2NvbmZpZy9zaGFyZWQudHMnIH0sICAgLy8gcHJpb3JpdHk6IDExIChhdXRvKVxuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9jb25maWcvZmlyZWJhc2UudHMnIH0gIC8vIHByaW9yaXR5OiAxMiAoYXV0bylcbiAqIF0pO1xuICogXG4gKiAvLyBBZHZhbmNlZCB1c2FnZSB3aXRoIGV4cGxpY2l0IHByaW9yaXRpZXNcbiAqIGNvbnN0IGRpTGF5ZXIgPSBuZXcgRElMYXllckNvbnN0cnVjdChbXG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2RpLnRzJywgcHJpb3JpdHk6IDEwIH0sICAgICAgICAvLyBMb2FkIGZpcnN0XG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2NvbmZpZy9maXJlYmFzZS50cycsIHByaW9yaXR5OiAyMCB9LCAvLyBMb2FkIGxhc3RcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvY29uZmlnL3NoYXJlZC50cycsIHByaW9yaXR5OiAxNSB9ICAgIC8vIExvYWQgaW4gYmV0d2VlblxuICogXSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIExheWVyQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyOiBJTG9nZ2VyO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgXG4gICAgbmFtZSA9IExheWVyQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgTGF5ZXJDb25zdHJ1Y3QgaW5zdGFuY2UuXG4gICAgICogQHBhcmFtIGNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgTGF5ZXJDb25zdHJ1Y3QuXG4gICAgICovXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSBjb25maWc6IElMYXllckNvbnN0cnVjdENvbmZpZ1tdLCB2ZXJib3NlTG9nID86IG51bWJlcikge1xuXG4gICAgICAgIGlmKHZlcmJvc2VMb2cpe1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIgPSBjcmVhdGVMb2dnZXIoTGF5ZXJDb25zdHJ1Y3QubmFtZSwgMSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihMYXllckNvbnN0cnVjdC5uYW1lKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gYWRkIGRlZmF1bHRzXG4gICAgICAgIGNvbmZpZy5mb3JFYWNoKChsYXllckNvbmZpZykgPT4ge1xuICAgICAgICAgICAgbGF5ZXJDb25maWcubW9kZSA9IGxheWVyQ29uZmlnLm1vZGUgfHwgJ1BBQ0tBR0VfRElSRUNUT1JZJztcbiAgICAgICAgICAgIGlmIChsYXllckNvbmZpZy5tb2RlID09PSAnQlVJTERfQU5EX1BBQ0tBR0UnKSB7XG4gICAgICAgICAgICAgICAgbGF5ZXJDb25maWcuY2xlYXJPdXRwdXREaXIgPSBsYXllckNvbmZpZy5jbGVhck91dHB1dERpciA/PyBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgSGVscGVyLmh5ZHJhdGVDb25maWcoY29uZmlnLCAnTEFZRVInKTtcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIC8vIEFzc2lnbiBwcmlvcml0eSB0byBlYWNoIGxheWVyOiB1c2UgZXhwbGljaXQgcHJpb3JpdHkgaWYgc2V0LCBvdGhlcndpc2UgdXNlIGFycmF5IGluZGV4ICsgMTBcbiAgICAgICAgLy8gUHJpb3JpdHkgMC05IHJlc2VydmVkIGZvciBmcmFtZXdvcmsgbGF5ZXJzIChmdzI0IGNvcmUgPSAwKVxuICAgICAgICAvLyBVc2VyIGxheWVycyBzdGFydCBhdCAxMCsgdG8gZW5zdXJlIGZyYW1ld29yayBsYXllcnMgYWx3YXlzIGxvYWQgZmlyc3RcbiAgICAgICAgdGhpcy5jb25maWcuZm9yRWFjaCgobGF5ZXJDb25maWcsIGluZGV4KSA9PiB7XG4gICAgICAgICAgICBpZiAoIWxheWVyQ29uZmlnLnByaW9yaXR5ICYmIGxheWVyQ29uZmlnLnByaW9yaXR5ICE9PSAwKSB7XG4gICAgICAgICAgICAgICAgbGF5ZXJDb25maWcucHJpb3JpdHkgPSBpbmRleCArIDEwO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBQcm9jZXNzIGxheWVycyBpbiBwYXJhbGxlbCBmb3Igc3BlZWQgd2hpbGUgcmVzcGVjdGluZyBwcmlvcml0eS1iYXNlZCBsb2FkaW5nIG9yZGVyXG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHRoaXMuY29uZmlnLm1hcChhc3luYyAobGF5ZXJDb25maWcpID0+IHtcbiAgICAgICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKGxheWVyQ29uZmlnLnN0YWNrTmFtZSB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkubGF5ZXJTdGFja05hbWUsIGxheWVyQ29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiUHJvY2Vzc2luZyBsYXllcjpcIiwgbGF5ZXJDb25maWcpO1xuXG4gICAgICAgICAgICBpZiAobGF5ZXJDb25maWcubW9kZSA9PT0gJ1BBQ0tBR0VfRElSRUNUT1JZJykge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGFja2FnZURpcmVjdG9yeShsYXllckNvbmZpZyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGxheWVyQ29uZmlnLm1vZGUgPT09ICdCVUlMRF9BTkRfUEFDS0FHRScpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNjYW5BbmRQYWNrYWdlRmlsZXMobGF5ZXJDb25maWcpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgbW9kZSBmb3IgbGF5ZXIgJHtsYXllckNvbmZpZ31gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFBhY2thZ2VzIGEgZGlyZWN0b3J5IGFzIGEgTGFtYmRhIGxheWVyLlxuICAgICAqIEBwYXJhbSBsYXllckNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgbGF5ZXIuXG4gICAgICogQHBhcmFtIG1haW5TdGFjayAtIFRoZSBtYWluIHN0YWNrIGZvciBkZXBsb3lpbmcgcmVzb3VyY2VzLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgcGFja2FnZURpcmVjdG9yeShsYXllckNvbmZpZzogSVBhY2thZ2VEaXJlY3RvcnlDb25maWcpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdExheWVyUHJvcHM6IExheWVyVmVyc2lvblByb3BzID0ge1xuICAgICAgICAgICAgbGF5ZXJWZXJzaW9uTmFtZTogbGF5ZXJDb25maWcubGF5ZXJOYW1lLFxuICAgICAgICAgICAgY29tcGF0aWJsZVJ1bnRpbWVzOiBbIFJ1bnRpbWUuTk9ERUpTXzIyX1ggXSxcbiAgICAgICAgICAgIGNvZGU6IENvZGUuZnJvbUFzc2V0KGxheWVyQ29uZmlnLnNvdXJjZVBhdGgpLFxuICAgICAgICAgICAgY29tcGF0aWJsZUFyY2hpdGVjdHVyZXM6IFtBcmNoaXRlY3R1cmUuQVJNXzY0XSxcbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGxheWVyID0gbmV3IExheWVyVmVyc2lvbih0aGlzLm1haW5TdGFjaywgbGF5ZXJDb25maWcubGF5ZXJOYW1lICsgJy1sYXllcicsIHtcbiAgICAgICAgICAgIC4uLmRlZmF1bHRMYXllclByb3BzLFxuICAgICAgICAgICAgLi4ubGF5ZXJDb25maWcubGF5ZXJQcm9wcyxcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIGxheWVyQ29uZmlnLmxheWVyTmFtZSwgbGF5ZXIsIE91dHB1dFR5cGUuTEFZRVIsICdsYXllclZlcnNpb25Bcm4nKTtcblxuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogU2NhbnMgYSBkaXJlY3RvcnkgZm9yIFR5cGVTY3JpcHQgZmlsZXMgYW5kIGNyZWF0ZXMgTGFtYmRhIGxheWVycyBmb3IgdGhlbS5cbiAgICAgKiBAcGFyYW0gbGF5ZXJDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIGxheWVyLlxuICAgICAqIEBwYXJhbSBtYWluU3RhY2sgLSBUaGUgbWFpbiBzdGFjayBmb3IgZGVwbG95aW5nIHJlc291cmNlcy5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHNjYW5BbmRQYWNrYWdlRmlsZXMobGF5ZXJDb25maWc6IElCdWlsZEFuZFBhY2thZ2VDb25maWcpIHtcbiAgICAgICAgLy8gRGVmYXVsdCB0byBhcHBsaWNhdGlvbidzIGRpc3QvbGF5ZXJzIGRpcmVjdG9yeSAocHJvY2Vzcy5jd2QoKSBpcyB0aGUgYXBwbGljYXRpb24gcm9vdClcbiAgICAgICAgY29uc3QgZGlzdERpcmVjdG9yeSA9IGxheWVyQ29uZmlnLmRpc3REaXJlY3RvcnkgfHwgcGF0aEpvaW4ocHJvY2Vzcy5jd2QoKSwgJ2Rpc3QvbGF5ZXJzJyk7XG4gICAgICAgIGNvbnN0IHNvdXJjZURpcmVjdG9yeU9yRmlsZU5hbWUgPSBwYXRoUmVzb2x2ZShsYXllckNvbmZpZy5zb3VyY2VQYXRoKTtcbiAgICAgICAgY29uc3QgdHNGaWxlcyA9IGxzdGF0U3luYyhzb3VyY2VEaXJlY3RvcnlPckZpbGVOYW1lKS5pc0RpcmVjdG9yeSgpXG4gICAgICAgICAgICA/IHNjYW5EaXJlY3Rvcnkoc291cmNlRGlyZWN0b3J5T3JGaWxlTmFtZSlcbiAgICAgICAgICAgIDogW3NvdXJjZURpcmVjdG9yeU9yRmlsZU5hbWVdO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgZmlsZXMgaW4gcGFyYWxsZWwgbm93IHRoYXQgd2UgaGF2ZSBwcmlvcml0eS1iYXNlZCBvcmRlcmluZ1xuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbCh0c0ZpbGVzLm1hcChhc3luYyAoZmlsZSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy50cnlDcmVhdGVMYXllckZvckZpbGUoZmlsZSwgZGlzdERpcmVjdG9yeSwgbGF5ZXJDb25maWcpO1xuICAgICAgICB9KSk7XG4gICAgfVxuXG4vKipcbiAqIENhbGN1bGF0ZSBzb3VyY2UgaGFzaCBmb3IgY2FjaGUgaW52YWxpZGF0aW9uXG4gKi9cbiAgICBwcml2YXRlIGNhbGN1bGF0ZUxheWVyU291cmNlSGFzaChmaWxlOiBzdHJpbmcsIGV4dGVybmFsUGFja2FnZXM6IChzdHJpbmcgfCBSZWdFeHApW10pOiBzdHJpbmcge1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDYWxjdWxhdGluZyBzb3VyY2UgaGFzaCBmb3IuLi5gLCB7IGZpbGUsIGV4dGVybmFsUGFja2FnZXMgfSk7XG4gICAgICAgIGNvbnN0IGhhc2ggPSBjcmVhdGVIYXNoKCdzaGEyNTYnKTtcbiAgICAgICAgXG4gICAgICAgIC8vIEhhc2ggc291cmNlIGZpbGVcbiAgICAgICAgaWYgKGV4aXN0c1N5bmMoZmlsZSkpIHtcbiAgICAgICAgICAgIGhhc2gudXBkYXRlKHJlYWRGaWxlU3luYyhmaWxlKSk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIEhhc2ggZXh0ZXJuYWwgcGFja2FnZXMgbGlzdFxuICAgICAgICBjb25zdCBwa2dOYW1lcyA9IGV4dGVybmFsUGFja2FnZXNcbiAgICAgICAgICAgIC5maWx0ZXIoKHBrZyk6IHBrZyBpcyBzdHJpbmcgPT4gdHlwZW9mIHBrZyA9PT0gJ3N0cmluZycpXG4gICAgICAgICAgICAuc29ydCgpO1xuICAgICAgICBoYXNoLnVwZGF0ZShKU09OLnN0cmluZ2lmeShwa2dOYW1lcykpO1xuICAgICAgICBcbiAgICAgICAgLy8gSGFzaCBwYWNrYWdlIHZlcnNpb25zIC0gaW5jbHVkZSBBTEwgZGVwZW5kZW5jaWVzIGlmIHRoZXkgZXhpc3QgaW4gcGFja2FnZS5qc29uXG4gICAgICAgIGNvbnN0IHByb2plY3RSb290ID0gcGF0aFJlc29sdmUocHJvY2Vzcy5jd2QoKSk7XG4gICAgICAgIGNvbnN0IHByb2plY3RQa2dQYXRoID0gcGF0aEpvaW4ocHJvamVjdFJvb3QsICdwYWNrYWdlLmpzb24nKTtcbiAgICAgICAgaWYgKGV4aXN0c1N5bmMocHJvamVjdFBrZ1BhdGgpKSB7XG4gICAgICAgICAgICBjb25zdCBwcm9qZWN0UGtnID0gSlNPTi5wYXJzZShyZWFkRmlsZVN5bmMocHJvamVjdFBrZ1BhdGgsICd1dGYtOCcpKTtcbiAgICAgICAgICAgIGNvbnN0IHJ1bnRpbWVEZXBzID0gcHJvamVjdFBrZy5kZXBlbmRlbmNpZXMgfHwge307XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEZvciBlYWNoIGRlcGVuZGVuY3ksIGNoZWNrIGlmIGl0J3MgYSBsb2NhbCBmaWxlIHJlZmVyZW5jZVxuICAgICAgICAgICAgLy8gSWYgc28sIGhhc2ggdGhlIGFjdHVhbCBkaXJlY3RvcnkgY29udGVudHMgaW5zdGVhZCBvZiB0aGUgdmVyc2lvbiBzdHJpbmdcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKHJ1bnRpbWVEZXBzKS5zb3J0KCkuZm9yRWFjaChwa2dOYW1lID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB2ZXJzaW9uID0gcnVudGltZURlcHNbcGtnTmFtZV07XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgaXQncyBhIGxvY2FsIGZpbGUgcmVmZXJlbmNlIChlLmcuLCBcImZpbGU6Li4vZncyNFwiLCBcIi4uL2Z3MjRcIiwgb3IgXCIvYWJzb2x1dGUvcGF0aFwiKVxuICAgICAgICAgICAgICAgIGNvbnN0IGlzTG9jYWxSZWYgPSB2ZXJzaW9uLnN0YXJ0c1dpdGgoJ2ZpbGU6JykgfHwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZlcnNpb24uc3RhcnRzV2l0aCgnLi8nKSB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmVyc2lvbi5zdGFydHNXaXRoKCcuLi8nKSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uLnN0YXJ0c1dpdGgoJy8nKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoaXNMb2NhbFJlZikge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBwa2dQYXRoID0gcGF0aEpvaW4ocHJvamVjdFJvb3QsICdub2RlX21vZHVsZXMnLCBwa2dOYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0c1N5bmMocGtnUGF0aCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCAgIOKGkiBEZXRlY3RpbmcgY2hhbmdlcyBpbiBsb2NhbCBwYWNrYWdlOiAke3BrZ05hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJIYXNoID0gdGhpcy5oYXNoRGlyZWN0b3J5KHBrZ1BhdGgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFzaC51cGRhdGUoYCR7cGtnTmFtZX06JHtkaXJIYXNofWApO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUGFja2FnZSBub3QgaW5zdGFsbGVkIHlldCwgaGFzaCB0aGUgdmVyc2lvbiBzdHJpbmdcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhc2gudXBkYXRlKGAke3BrZ05hbWV9OiR7dmVyc2lvbn1gKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFJlZ3VsYXIgdmVyc2lvbmVkIGRlcGVuZGVuY3lcbiAgICAgICAgICAgICAgICAgICAgaGFzaC51cGRhdGUoYCR7cGtnTmFtZX06JHt2ZXJzaW9ufWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gaGFzaC5kaWdlc3QoJ2hleCcpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEhhc2ggYSBkaXJlY3RvcnkncyBjb250ZW50cyByZWN1cnNpdmVseVxuICAgICAqL1xuICAgIHByaXZhdGUgaGFzaERpcmVjdG9yeShkaXJQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgICAgICBjb25zdCBoYXNoID0gY3JlYXRlSGFzaCgnc2hhMjU2Jyk7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBoYXNoRGlyUmVjdXJzaXZlID0gKGN1cnJlbnRQYXRoOiBzdHJpbmcpID0+IHtcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhjdXJyZW50UGF0aCkpIHJldHVybjtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY29uc3Qgc3RhdCA9IGxzdGF0U3luYyhjdXJyZW50UGF0aCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChzdGF0LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpdGVtcyA9IHJlYWRkaXJTeW5jKGN1cnJlbnRQYXRoKS5zb3J0KCk7XG4gICAgICAgICAgICAgICAgaXRlbXMuZm9yRWFjaChpdGVtID0+IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gU2tpcCBub2RlX21vZHVsZXMgc3ViZGlyZWN0b3JpZXMgdG8gYXZvaWQgaW5maW5pdGUgcmVjdXJzaW9uXG4gICAgICAgICAgICAgICAgICAgIGlmIChpdGVtID09PSAnbm9kZV9tb2R1bGVzJykgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICBoYXNoRGlyUmVjdXJzaXZlKHBhdGhKb2luKGN1cnJlbnRQYXRoLCBpdGVtKSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHN0YXQuaXNGaWxlKCkpIHtcbiAgICAgICAgICAgICAgICAvLyBIYXNoIGZpbGUgcGF0aCBhbmQgY29udGVudHNcbiAgICAgICAgICAgICAgICBoYXNoLnVwZGF0ZShjdXJyZW50UGF0aCk7XG4gICAgICAgICAgICAgICAgaGFzaC51cGRhdGUocmVhZEZpbGVTeW5jKGN1cnJlbnRQYXRoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIFxuICAgICAgICBoYXNoRGlyUmVjdXJzaXZlKGRpclBhdGgpO1xuICAgICAgICByZXR1cm4gaGFzaC5kaWdlc3QoJ2hleCcpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIE1lcmdlcyBidWlsZCBvcHRpb25zIHdpdGggcHJvcGVyIHByaW9yaXR5OiBkZWZhdWx0cyA8IGNvbnN0cnVjdC1sZXZlbCA8IGRlY29yYXRvci1sZXZlbFxuICAgICAqIEBwYXJhbSBsYXllck5hbWUgLSBMYXllciBuYW1lIGZvciBsb2dnaW5nXG4gICAgICogQHBhcmFtIGNvbnN0cnVjdEJ1aWxkT3B0aW9ucyAtIEJ1aWxkIG9wdGlvbnMgZnJvbSBjb25zdHJ1Y3QgY29uZmlnXG4gICAgICogQHBhcmFtIGRlY29yYXRvckJ1aWxkT3B0aW9ucyAtIEJ1aWxkIG9wdGlvbnMgZnJvbSBATGF5ZXJFbnRyeSBkZWNvcmF0b3JcbiAgICAgKiBAcmV0dXJucyBNZXJnZWQgYnVpbGQgb3B0aW9uc1xuICAgICAqL1xuICAgIHByaXZhdGUgbWVyZ2VCdWlsZE9wdGlvbnMoXG4gICAgICAgIGxheWVyTmFtZTogc3RyaW5nLFxuICAgICAgICBjb25zdHJ1Y3RCdWlsZE9wdGlvbnM/OiBCdWlsZE9wdGlvbnMsXG4gICAgICAgIGRlY29yYXRvckJ1aWxkT3B0aW9ucz86IEJ1aWxkT3B0aW9uc1xuICAgICk6IEJ1aWxkT3B0aW9ucyB7XG4gICAgICAgIC8vIERlZmF1bHQgYnVpbGQgb3B0aW9ucyBmb3IgYWxsIGxheWVyc1xuICAgICAgICBjb25zdCBkZWZhdWx0QnVpbGRPcHRpb25zOiBCdWlsZE9wdGlvbnMgPSB7XG4gICAgICAgICAgICBidW5kbGU6IHRydWUsXG4gICAgICAgICAgICBwbGF0Zm9ybTogJ25vZGUnLFxuICAgICAgICAgICAgdGFyZ2V0OiAnbm9kZTE4JyxcbiAgICAgICAgICAgIG1pbmlmeTogZmFsc2UsXG4gICAgICAgICAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgICAgICAgICAgZXh0ZXJuYWw6IFtcbiAgICAgICAgICAgICAgICAvLyBGcmFtZXdvcmsgcnVudGltZSBwcm92aWRlZCBieSBzZXBhcmF0ZSBmdzI0IGxheWVyXG4gICAgICAgICAgICAgICAgJ0B0ZW4yNGdyb3VwL2Z3MjQnLFxuICAgICAgICAgICAgICAgIC8vIEFXUyBTREsgYW5kIGJ1aWxkIHRvb2xzXG4gICAgICAgICAgICAgICAgJ0Bhd3Mtc2RrJyxcbiAgICAgICAgICAgICAgICAnQHNtaXRoeScsXG4gICAgICAgICAgICAgICAgJ2F3cy1jZGstbGliJyxcbiAgICAgICAgICAgICAgICAnZXNidWlsZCcsXG4gICAgICAgICAgICBdXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gTWVyZ2UgaW4gcHJpb3JpdHkgb3JkZXIgdXNpbmcgZGVlcCBtZXJnZVxuICAgICAgICBjb25zdCBtZXJnZWQgPSAobWVyZ2UoW1xuICAgICAgICAgICAgZGVmYXVsdEJ1aWxkT3B0aW9ucyxcbiAgICAgICAgICAgIGNvbnN0cnVjdEJ1aWxkT3B0aW9ucyB8fCB7fSxcbiAgICAgICAgICAgIGRlY29yYXRvckJ1aWxkT3B0aW9ucyB8fCB7fVxuICAgICAgICBdKSB8fCBkZWZhdWx0QnVpbGRPcHRpb25zKSBhcyBCdWlsZE9wdGlvbnM7XG5cbiAgICAgICAgLy8gTG9nIG1lcmdlZCBjb25maWd1cmF0aW9uXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBbJHtsYXllck5hbWV9XSBCdWlsZCBvcHRpb25zIG1lcmdlZDpgLCB7XG4gICAgICAgICAgICBzb3VyY2VtYXA6IG1lcmdlZC5zb3VyY2VtYXAsXG4gICAgICAgICAgICBtaW5pZnk6IG1lcmdlZC5taW5pZnksXG4gICAgICAgICAgICBleHRlcm5hbDogbWVyZ2VkLmV4dGVybmFsLFxuICAgICAgICAgICAgcGxhdGZvcm06IG1lcmdlZC5wbGF0Zm9ybSxcbiAgICAgICAgICAgIHRhcmdldDogbWVyZ2VkLnRhcmdldFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gbWVyZ2VkO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEF0dGVtcHRzIHRvIGNyZWF0ZSBhIExhbWJkYSBsYXllciBmb3IgYSBnaXZlbiBUeXBlU2NyaXB0IGZpbGUuXG4gICAgICogQHBhcmFtIGZpbGUgLSBUaGUgcGF0aCB0byB0aGUgVHlwZVNjcmlwdCBmaWxlLlxuICAgICAqIEBwYXJhbSBkaXN0RGlyZWN0b3J5IC0gVGhlIG91dHB1dCBkaXJlY3RvcnkgZm9yIHRoZSBidWlsZC5cbiAgICAgKiBAcGFyYW0gbWFpblN0YWNrIC0gVGhlIG1haW4gc3RhY2sgZm9yIGRlcGxveWluZyByZXNvdXJjZXMuXG4gICAgICogQHBhcmFtIGxheWVyQ29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBsYXllci5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHRyeUNyZWF0ZUxheWVyRm9yRmlsZShmaWxlOiBzdHJpbmcsIGRpc3REaXJlY3Rvcnk6IHN0cmluZywgbGF5ZXJDb25maWc6IElCdWlsZEFuZFBhY2thZ2VDb25maWcpIHtcbiAgICAgICAgY29uc3QgZmlsZUJhc2VOYW1lID0gcGF0aEJhc2VOYW1lKGZpbGUsIHBhdGhFeHRuYW1lKGZpbGUpKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgUHJvY2Vzc2luZyBsYXllcjogJHtmaWxlQmFzZU5hbWV9YCk7XG4gICAgICAgIFxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgTG9hZGluZyBsYXllciBkZXNjcmlwdG9yIGZyb20gJHtmaWxlfS4uLmApO1xuICAgICAgICBjb25zdCBtb2R1bGVFeHBvcnRzID0gYXdhaXQgaW1wb3J0KGZpbGUpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgTGF5ZXIgZGVzY3JpcHRvciBsb2FkZWRgKTtcblxuICAgICAgICBjb25zdCBmb3VuZExheWVyRGVzY3JpcHRvck5hbWUgPSBPYmplY3Qua2V5cyhtb2R1bGVFeHBvcnRzKS5maW5kKChrZXkpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGV4cG9ydGVkID0gbW9kdWxlRXhwb3J0c1trZXldO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRlZCA9PT0gJ2Z1bmN0aW9uJyAmJiBpc0xheWVyRW50cnkoZXhwb3J0ZWQpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4cG9ydGVkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgXG4gICAgICAgIGlmKCFmb3VuZExheWVyRGVzY3JpcHRvck5hbWUpe1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gTGF5ZXJFbnRyeSBmb3VuZCBpbiBmaWxlICR7ZmlsZX0uIFdpbGwgdXNlIERlZmF1bHQgb3B0aW9ucy5gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIExheWVyRW50cnkoeyBcbiAgICAgICAgICAgIG5vdEdsb2JhbDogbGF5ZXJDb25maWcubm90R2xvYmFsID8/IGZhbHNlLFxuICAgICAgICAgICAgaXNFbnRyeVBhY2thZ2U6IGxheWVyQ29uZmlnLmlzRW50cnlQYWNrYWdlID8/IGZhbHNlXG4gICAgICAgIH0pXG4gICAgICAgIGNsYXNzIEVtcHR5TGF5ZXJEZXNjcmlwdG9yIHt9XG5cbiAgICAgICAgLy8gaWYgbm8gbGF5ZXIgZGVzY3JpcHRvciBmb3VuZCBpbiB0aGUgZmlsZSwgY3JlYXRlIGFuIGVtcHR5IGNsYXNzIHdoaWNoIHdpbGwgdXNlIGRlZmF1bHQgb3B0aW9uc1xuICAgICAgICBjb25zdCBsYXllckRlc2NyaXB0b3IgPSBmb3VuZExheWVyRGVzY3JpcHRvck5hbWUgPyBtb2R1bGVFeHBvcnRzW2ZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZV0gOiBFbXB0eUxheWVyRGVzY3JpcHRvcjtcblxuICAgICAgICBjb25zdCBsYXllck5hbWUgPSBnZXRMYXllck5hbWUobGF5ZXJEZXNjcmlwdG9yKSB8fCBmaWxlQmFzZU5hbWU7XG4gICAgICAgIFxuICAgICAgICAvLyBNZXJnZSBidWlsZCBvcHRpb25zOiBkZWZhdWx0cyA8IGNvbnN0cnVjdC1sZXZlbCA8IGRlY29yYXRvci1sZXZlbFxuICAgICAgICBjb25zdCBkZWNvcmF0b3JCdWlsZE9wdGlvbnMgPSBnZXRMYXllckJ1aWxkT3B0aW9ucyhsYXllckRlc2NyaXB0b3IpO1xuICAgICAgICBjb25zdCBidWlsZE9wdGlvbnMgPSB0aGlzLm1lcmdlQnVpbGRPcHRpb25zKFxuICAgICAgICAgICAgbGF5ZXJOYW1lLFxuICAgICAgICAgICAgbGF5ZXJDb25maWcuYnVpbGRPcHRpb25zLFxuICAgICAgICAgICAgZGVjb3JhdG9yQnVpbGRPcHRpb25zXG4gICAgICAgICk7XG4gICAgICAgIFxuICAgICAgICAvLyBEZXRlcm1pbmUgcGFja2FnZSBzdHJ1Y3R1cmU6XG4gICAgICAgIC8vIC0gSWYgcGFja2FnZVBhdGggaXMgc2V0OiB1c2UgaXQgYXMgdGhlIGZ1bGwgbW9kdWxlIHBhdGggKGUuZy4sIEB0ZW4yNGdyb3VwL2Z3MjQpXG4gICAgICAgIC8vIC0gSWYgbm90IHNldDogdXNlIGZpbGVCYXNlTmFtZSBhcyB0aGUgcGFja2FnZSBuYW1lIChlLmcuLCBkaSwgc2hhcmVkKVxuICAgICAgICBjb25zdCBwYWNrYWdlTmFtZSA9IGxheWVyQ29uZmlnLnBhY2thZ2VQYXRoIHx8IGZpbGVCYXNlTmFtZTtcbiAgICAgICAgY29uc3QgY29uZmlndXJlZE91dHB1dFBhdGggPSBgbm9kZWpzL25vZGVfbW9kdWxlcy8ke3BhY2thZ2VOYW1lfWA7XG4gICAgXG4gICAgICAgIGNvbnN0IG91dHB1dERpciA9IHBhdGhKb2luKGRpc3REaXJlY3RvcnksIGxheWVyTmFtZSwgY29uZmlndXJlZE91dHB1dFBhdGgpO1xuICAgICAgICBjb25zdCBidW5kbGVEaXIgPSBwYXRoSm9pbihkaXN0RGlyZWN0b3J5LCBsYXllck5hbWUpO1xuICAgICAgICBjb25zdCBvdXRwdXROb2RlanNEaXIgPSBwYXRoSm9pbihidW5kbGVEaXIsICdub2RlanMnKTtcbiAgICAgICAgY29uc3QgaGFzaEZpbGUgPSBwYXRoSm9pbihidW5kbGVEaXIsICcuYnVpbGQtaGFzaCcpO1xuXG4gICAgICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgICAgICAvLyBPUFRJTUlaQVRJT046IENoZWNrIGlmIHJlYnVpbGQgbmVlZGVkIHZpYSBzb3VyY2UgaGFzaFxuICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgY29uc3QgZXh0ZXJuYWxQYWNrYWdlcyA9IChidWlsZE9wdGlvbnMuZXh0ZXJuYWwgJiYgQXJyYXkuaXNBcnJheShidWlsZE9wdGlvbnMuZXh0ZXJuYWwpKSA/IGJ1aWxkT3B0aW9ucy5leHRlcm5hbCA6IFtdO1xuICAgICAgICBjb25zdCBjdXJyZW50SGFzaCA9IHRoaXMuY2FsY3VsYXRlTGF5ZXJTb3VyY2VIYXNoKGZpbGUsIGV4dGVybmFsUGFja2FnZXMpO1xuICAgICAgICBcbiAgICAgICAgbGV0IG5lZWRzUmVidWlsZCA9IHRydWU7XG4gICAgICAgIGxldCByZWJ1aWxkUmVhc29uID0gJ0ZpcnN0IGJ1aWxkJztcbiAgICAgICAgXG4gICAgICAgIGlmIChleGlzdHNTeW5jKG91dHB1dE5vZGVqc0RpcikgJiYgZXhpc3RzU3luYyhoYXNoRmlsZSkpIHtcbiAgICAgICAgICAgIGNvbnN0IHByZXZpb3VzSGFzaCA9IHJlYWRGaWxlU3luYyhoYXNoRmlsZSwgJ3V0Zi04JykudHJpbSgpO1xuICAgICAgICAgICAgaWYgKHByZXZpb3VzSGFzaCA9PT0gY3VycmVudEhhc2gpIHtcbiAgICAgICAgICAgICAgICBuZWVkc1JlYnVpbGQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICByZWJ1aWxkUmVhc29uID0gJ05vIHNvdXJjZSBjaGFuZ2VzIGRldGVjdGVkJztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmVidWlsZFJlYXNvbiA9ICdTb3VyY2UgY29kZSBvciBkZXBlbmRlbmNpZXMgY2hhbmdlZCc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoZXhpc3RzU3luYyhvdXRwdXROb2RlanNEaXIpKSB7XG4gICAgICAgICAgICByZWJ1aWxkUmVhc29uID0gJ0J1aWxkIGhhc2ggbWlzc2luZyAocmVidWlsZGluZyBmb3Igc2FmZXR5KSc7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmICghbmVlZHNSZWJ1aWxkKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSDinJMgJHtyZWJ1aWxkUmVhc29ufSAtIHVzaW5nIGNhY2hlZCBidWlsZGApO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBTdGlsbCBuZWVkIHRvIHJlZ2lzdGVyIGxheWVyIHdpdGggQ0RLLCBidXQgc2tpcCBleHBlbnNpdmUgcmVidWlsZFxuICAgICAgICAgICAgY29uc3QgbGF5ZXJQcm9wcyA9IGdldExheWVyUHJvcHMobGF5ZXJEZXNjcmlwdG9yKTtcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRMYXllclByb3BzOiBMYXllclZlcnNpb25Qcm9wcyA9IHtcbiAgICAgICAgICAgICAgICBsYXllclZlcnNpb25OYW1lOiBsYXllck5hbWUsXG4gICAgICAgICAgICAgICAgY29tcGF0aWJsZVJ1bnRpbWVzOiBbIFJ1bnRpbWUuTk9ERUpTXzIyX1ggXSxcbiAgICAgICAgICAgICAgICBjb2RlOiBDb2RlLmZyb21Bc3NldChidW5kbGVEaXIpLFxuICAgICAgICAgICAgICAgIGNvbXBhdGlibGVBcmNoaXRlY3R1cmVzOiBbQXJjaGl0ZWN0dXJlLkFSTV82NF0sXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCBsYXllciA9IG5ldyBMYXllclZlcnNpb24odGhpcy5tYWluU3RhY2ssIGxheWVyTmFtZSArICctbGF5ZXInLCB7XG4gICAgICAgICAgICAgICAgLi4uZGVmYXVsdExheWVyUHJvcHMsXG4gICAgICAgICAgICAgICAgLi4ubGF5ZXJDb25maWcubGF5ZXJQcm9wcyxcbiAgICAgICAgICAgICAgICAuLi5sYXllclByb3BzLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgbGF5ZXJOYW1lLCBsYXllciwgT3V0cHV0VHlwZS5MQVlFUiwgJ2xheWVyVmVyc2lvbkFybicpO1xuXG4gICAgICAgICAgICAvLyBJbXBvcnQgcGF0aDogL29wdC9ub2RlanMvbm9kZV9tb2R1bGVzL3twYWNrYWdlTmFtZX0vaW5kZXguanNcbiAgICAgICAgICAgIC8vIE5vZGUuanMgd2lsbCByZXNvbHZlIHRoaXMgdG8gdGhlIGJ1bmRsZWQgZW50cnkgcG9pbnRcbiAgICAgICAgICAgIGNvbnN0IGxheWVySW1wb3J0UGF0aCA9IHBhdGhKb2luKCcvb3B0JywgY29uZmlndXJlZE91dHB1dFBhdGgsICdpbmRleC5qcycpO1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUobGF5ZXJOYW1lLCBsYXllckltcG9ydFBhdGgsICdsYXllckltcG9ydFBhdGgnKTtcblxuICAgICAgICAgICAgaWYoaXNHbG9iYWxMYXllcihsYXllckRlc2NyaXB0b3IpKXtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyhsYXllck5hbWUpO1xuICAgICAgICAgICAgICAgIGlmIChsYXllckNvbmZpZy5wcmlvcml0eSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTGF5ZXIgJHtsYXllck5hbWV9IGhhcyBubyBwcmlvcml0eS4gVGhpcyBzaG91bGQgbmV2ZXIgaGFwcGVuLmApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlKGBlbnY6bGF5ZXJJbXBvcnRQYXRoOiR7bGF5ZXJOYW1lfWAsIGxheWVyQ29uZmlnLnByaW9yaXR5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuOyAvLyBET05FIC0gc2F2ZWQgfjE1IHNlY29uZHMhXG4gICAgICAgIH1cblxuICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgLy8gUkVCVUlMRCBORUVERUQ6IERvIHRoZSBleHBlbnNpdmUgd29ya1xuICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gUmVidWlsZGluZzogJHtyZWJ1aWxkUmVhc29ufWApO1xuICAgICAgICBjb25zdCBidWlsZFN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICAgICAgLy8gRW5zdXJlIG91dHB1dCBkaXJlY3RvcnkgZXhpc3RzXG4gICAgICAgIGlmICghZXhpc3RzU3luYyhvdXRwdXREaXIpKSB7XG4gICAgICAgICAgICBta2RpclN5bmMob3V0cHV0RGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEluc3RhbGwgZXh0ZXJuYWwgZGVwZW5kZW5jaWVzIEZJUlNUIChzbyBucG0gaW5zdGFsbCBkb2Vzbid0IGRlbGV0ZSBidW5kbGVkIGNvZGUhKVxuICAgICAgICBpZiAoZXh0ZXJuYWxQYWNrYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBbMS8zXSBJbnN0YWxsaW5nIGV4dGVybmFsIGRlcGVuZGVuY2llcy4uLmApO1xuICAgICAgICAgICAgYXdhaXQgaW5zdGFsbEV4dGVybmFsRGVwZW5kZW5jaWVzT3B0aW1pemVkKGJ1bmRsZURpciwgZXh0ZXJuYWxQYWNrYWdlcywgdGhpcy5sb2dnZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVGhlbiBidW5kbGUgYXBwbGljYXRpb24gY29kZSBpbnRvIG5vZGVfbW9kdWxlc1xuICAgICAgICBjb25zdCBvdXRwdXRGaWxlID0gcGF0aEpvaW4ob3V0cHV0RGlyLCAnaW5kZXguanMnKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gWzIvM10gQnVuZGxpbmcgd2l0aCBlc2J1aWxkLi4uYCk7XG4gICAgICAgIGF3YWl0IGJ1bmRsZVdpdGhFc2J1aWxkKGZpbGUsIG91dHB1dEZpbGUsIGJ1aWxkT3B0aW9ucyk7XG5cbiAgICAgICAgLy8gU2F2ZSBoYXNoIGZvciBuZXh0IHJ1blxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBbMy8zXSBTYXZpbmcgYnVpbGQgbWV0YWRhdGEuLi5gKTtcbiAgICAgICAgd3JpdGVGaWxlU3luYyhoYXNoRmlsZSwgY3VycmVudEhhc2gpO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgZWxhcHNlZCA9ICgoRGF0ZS5ub3coKSAtIGJ1aWxkU3RhcnRUaW1lKSAvIDEwMDApLnRvRml4ZWQoMSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIOKckyBCdWlsZCBjb21wbGV0ZSBpbiAke2VsYXBzZWR9c2ApXG5cbiAgICAgICAgLy8gSW1wb3J0IHBhdGg6IC9vcHQvbm9kZWpzL25vZGVfbW9kdWxlcy97cGFja2FnZU5hbWV9L2luZGV4LmpzXG4gICAgICAgIC8vIE5vZGUuanMgd2lsbCByZXNvbHZlIHRoaXMgdG8gdGhlIGJ1bmRsZWQgZW50cnkgcG9pbnRcbiAgICAgICAgY29uc3QgbGF5ZXJJbXBvcnRQYXRoID0gcGF0aEpvaW4oJy9vcHQnLCBjb25maWd1cmVkT3V0cHV0UGF0aCwgJ2luZGV4LmpzJyk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIExheWVyIGltcG9ydCBwYXRoOiAke2xheWVySW1wb3J0UGF0aH1gKTtcblxuICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShsYXllck5hbWUsIGxheWVySW1wb3J0UGF0aCwgJ2xheWVySW1wb3J0UGF0aCcpO1xuXG4gICAgICAgIGlmKGlzR2xvYmFsTGF5ZXIobGF5ZXJEZXNjcmlwdG9yKSl7XG4gICAgICAgICAgICAvLyBBdHRhY2ggdGhpcyBsYXllciB0byBhbGwgTGFtYmRhIGZ1bmN0aW9uc1xuICAgICAgICAgICAgdGhpcy5mdzI0LmFkZEdsb2JhbExhbWJkYUxheWVyTmFtZXMobGF5ZXJOYW1lKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gT25seSBhZGQgYXMgZW50cnkgcGFja2FnZSBpZiBpdCBuZWVkcyB0byBleGVjdXRlIGF0IG1vZHVsZSBpbml0aWFsaXphdGlvblxuICAgICAgICAgICAgaWYgKGlzRW50cnlQYWNrYWdlKGxheWVyRGVzY3JpcHRvcikpIHtcbiAgICAgICAgICAgICAgICAvLyBjb2xsZWN0IGdsb2JhbCBlbnRyeS1wYWNrYWdlcyBmb3IgbGFtYmRhcyB3aXRoIHByaW9yaXR5IGZvciBjb3JyZWN0IGxvYWRpbmcgb3JkZXJcbiAgICAgICAgICAgICAgICAvLyBQcmlvcml0eSBpcyBhbHdheXMgc2V0IGluIGNvbnN0cnVjdCgpLCBzbyBpdCBtdXN0IGJlIGRlZmluZWQgaGVyZVxuICAgICAgICAgICAgICAgIGlmIChsYXllckNvbmZpZy5wcmlvcml0eSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTGF5ZXIgJHtsYXllck5hbWV9IGhhcyBubyBwcmlvcml0eS4gVGhpcyBzaG91bGQgbmV2ZXIgaGFwcGVuLmApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsTGFtYmRhRW50cnlQYWNrYWdlKGBlbnY6bGF5ZXJJbXBvcnRQYXRoOiR7bGF5ZXJOYW1lfWAsIGxheWVyQ29uZmlnLnByaW9yaXR5KTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBSZWdpc3RlcmVkIGFzIGVudHJ5IHBhY2thZ2UgKHByaW9yaXR5OiAke2xheWVyQ29uZmlnLnByaW9yaXR5fSlgKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gTGF5ZXIgYXR0YWNoZWQgYnV0IE5PVCBhbiBlbnRyeSBwYWNrYWdlIChhdmFpbGFibGUgZm9yIGltcG9ydCBvbmx5KWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbGF5ZXJQcm9wcyA9IGdldExheWVyUHJvcHMobGF5ZXJEZXNjcmlwdG9yKTtcblxuICAgICAgICBjb25zdCBkZWZhdWx0TGF5ZXJQcm9wczogTGF5ZXJWZXJzaW9uUHJvcHMgPSB7XG4gICAgICAgICAgICBsYXllclZlcnNpb25OYW1lOiBsYXllck5hbWUsXG4gICAgICAgICAgICBjb21wYXRpYmxlUnVudGltZXM6IFsgUnVudGltZS5OT0RFSlNfMjJfWCBdLFxuICAgICAgICAgICAgY29kZTogQ29kZS5mcm9tQXNzZXQoYnVuZGxlRGlyKSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVBcmNoaXRlY3R1cmVzOiBbQXJjaGl0ZWN0dXJlLkFSTV82NF0sXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgbGF5ZXIgPSBuZXcgTGF5ZXJWZXJzaW9uKHRoaXMubWFpblN0YWNrLCBsYXllck5hbWUgKyAnLWxheWVyJywge1xuICAgICAgICAgICAgLi4uZGVmYXVsdExheWVyUHJvcHMsXG4gICAgICAgICAgICAuLi5sYXllckNvbmZpZy5sYXllclByb3BzLFxuICAgICAgICAgICAgLi4ubGF5ZXJQcm9wcywgLy8gdGhlIGxheWVyUHJvcHMgZnJvbSB0aGUgZGVjb3JhdG9yIHRha2UgcHJlY2VkZW5jZVxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIGxheWVyTmFtZSwgbGF5ZXIsIE91dHB1dFR5cGUuTEFZRVIsICdsYXllclZlcnNpb25Bcm4nKTtcblxuICAgICAgICAvLyBDbGVhbiB1cCB0aGUgdGVtcG9yYXJ5IG91dHB1dCBkaXJlY3RvcnkgaWYgY29uZmlndXJlZFxuICAgICAgICBpZiAobGF5ZXJDb25maWcuY2xlYXJPdXRwdXREaXIpIHtcbiAgICAgICAgICAgIGNsZWFudXBEaXJlY3Rvcnkob3V0cHV0RGlyKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLyoqXG4gKiBSZWN1cnNpdmVseSBzY2FucyBhIGRpcmVjdG9yeSBhbmQgcmV0dXJucyBhIGxpc3Qgb2YgVHlwZVNjcmlwdCBmaWxlcy5cbiAqIEBwYXJhbSBkaXJlY3RvcnkgLSBUaGUgZGlyZWN0b3J5IHRvIHNjYW4uXG4gKiBAcmV0dXJucyBBbiBhcnJheSBvZiBUeXBlU2NyaXB0IGZpbGUgcGF0aHMuXG4gKi9cbmZ1bmN0aW9uIHNjYW5EaXJlY3RvcnkoZGlyZWN0b3J5OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgbGV0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGl0ZW1zID0gcmVhZGRpclN5bmMoZGlyZWN0b3J5KTtcblxuICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgICAgICBjb25zdCBmdWxsUGF0aCA9IHBhdGhKb2luKGRpcmVjdG9yeSwgaXRlbSk7XG4gICAgICAgIGNvbnN0IHN0YXQgPSBzdGF0U3luYyhmdWxsUGF0aCk7XG5cbiAgICAgICAgaWYgKHN0YXQuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgICAgZmlsZXMgPSBmaWxlcy5jb25jYXQoc2NhbkRpcmVjdG9yeShmdWxsUGF0aCkpO1xuICAgICAgICB9IGVsc2UgaWYgKHN0YXQuaXNGaWxlKCkgJiYgZnVsbFBhdGguZW5kc1dpdGgoJy50cycpKSB7XG4gICAgICAgICAgICBmaWxlcy5wdXNoKGZ1bGxQYXRoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmaWxlcztcbn1cblxuZnVuY3Rpb24gaXNMYXllckVudHJ5KHRhcmdldDogRnVuY3Rpb24pOiBib29sZWFuIHtcbiAgICByZXR1cm4gISFnZXRMYXllck5hbWUodGFyZ2V0KTtcbn1cblxuZnVuY3Rpb24gaXNHbG9iYWxMYXllcih0YXJnZXQ6IEZ1bmN0aW9uKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuICFSZWZsZWN0LmdldCh0YXJnZXQsICdub3RHbG9iYWwnKTtcbn1cblxuZnVuY3Rpb24gaXNFbnRyeVBhY2thZ2UodGFyZ2V0OiBGdW5jdGlvbik6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHZhbHVlID0gUmVmbGVjdC5nZXQodGFyZ2V0LCAnaXNFbnRyeVBhY2thZ2UnKTtcbiAgICAvLyBEZWZhdWx0IHRvIHRydWUgaWYgbm90IHNwZWNpZmllZFxuICAgIHJldHVybiB2YWx1ZSAhPT0gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIGdldExheWVyTmFtZSh0YXJnZXQ6IEZ1bmN0aW9uKSB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRhcmdldCwgJ2xheWVyTmFtZScpO1xufVxuXG5mdW5jdGlvbiBnZXRMYXllckJ1aWxkT3B0aW9ucyh0YXJnZXQ6IEZ1bmN0aW9uKTogQnVpbGRPcHRpb25zIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGFyZ2V0LCAnYnVpbGRPcHRpb25zJyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRMYXllclByb3BzKHRhcmdldDogRnVuY3Rpb24pOiBMYXllclZlcnNpb25Qcm9wcyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRhcmdldCwgJ2xheWVyUHJvcHMnKTtcbn1cblxuLyoqXG4gKiBCdW5kbGVzIGEgVHlwZVNjcmlwdCBmaWxlIHVzaW5nIGVzYnVpbGQgd2l0aCB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIEJ1aWxkIG9wdGlvbnMgc2hvdWxkIGFscmVhZHkgYmUgbWVyZ2VkIHZpYSBtZXJnZUJ1aWxkT3B0aW9ucygpLlxuICogQHBhcmFtIGVudHJ5RmlsZSAtIFRoZSBlbnRyeSBmaWxlIHRvIGJ1bmRsZS5cbiAqIEBwYXJhbSBvdXRwdXRGaWxlIC0gVGhlIG91dHB1dCBmaWxlIHBhdGggZm9yIHRoZSBidW5kbGUuXG4gKiBAcGFyYW0gYnVpbGRPcHRpb25zIC0gUHJlLW1lcmdlZCBidWlsZCBvcHRpb25zIGZvciBlc2J1aWxkLlxuICovXG5hc3luYyBmdW5jdGlvbiBidW5kbGVXaXRoRXNidWlsZChlbnRyeUZpbGU6IHN0cmluZywgb3V0cHV0RmlsZTogc3RyaW5nLCBidWlsZE9wdGlvbnM6IEJ1aWxkT3B0aW9ucykge1xuICAgIGNvbnN0IGZpbmFsT3B0aW9uczogQnVpbGRPcHRpb25zID0ge1xuICAgICAgICAuLi5idWlsZE9wdGlvbnMsXG4gICAgICAgIG91dGZpbGU6IG91dHB1dEZpbGUsXG4gICAgICAgIGVudHJ5UG9pbnRzOiBbZW50cnlGaWxlXSxcbiAgICB9O1xuXG4gICAgRGVmYXVsdExvZ2dlci5kZWJ1ZyhgYnVuZGxlV2l0aEVzYnVpbGQ6ICR7ZW50cnlGaWxlfSDihpIgJHtvdXRwdXRGaWxlfWApO1xuICAgIGF3YWl0IGJ1aWxkKGZpbmFsT3B0aW9ucyk7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlcyBoYXNoIG9mIGEgZmlsZSdzIGNvbnRlbnRzXG4gKi9cbmZ1bmN0aW9uIGNhbGN1bGF0ZUZpbGVIYXNoKGZpbGVQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkRmlsZVN5bmMoZmlsZVBhdGgpO1xuICAgIHJldHVybiBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoY29udGVudCkuZGlnZXN0KCdoZXgnKTtcbn1cblxuXG4vKipcbiAqIENsZWFucyB1cCBhIHRlbXBvcmFyeSBkaXJlY3RvcnkgYnkgcmVtb3ZpbmcgYWxsIGZpbGVzIGFuZCBzdWJkaXJlY3Rvcmllcy5cbiAqIEBwYXJhbSBkaXJlY3RvcnkgLSBUaGUgZGlyZWN0b3J5IHRvIGNsZWFuIHVwLlxuICovXG5mdW5jdGlvbiBjbGVhbnVwRGlyZWN0b3J5KGRpcmVjdG9yeTogc3RyaW5nKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgcm1TeW5jKGRpcmVjdG9yeSwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYGJ1bmRsZVdpdGhFc2J1aWxkOiBDbGVhbmVkIHVwIHRlbXBvcmFyeSBkaXJlY3Rvcnk6ICR7ZGlyZWN0b3J5fWApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuZXJyb3IoYGJ1bmRsZVdpdGhFc2J1aWxkOiBGYWlsZWQgdG8gY2xlYW4gdXAgZGlyZWN0b3J5ICR7ZGlyZWN0b3J5fTpgLCBlcnJvcik7XG4gICAgfVxufVxuXG4vKipcbiAqIE9QVElNSVpFRDogSW5zdGFsbHMgZXh0ZXJuYWwgZGVwZW5kZW5jaWVzIHdpdGggaW50ZWxsaWdlbnQgY2FjaGluZ1xuICogXG4gKiBAcGFyYW0gbGF5ZXJPdXRwdXREaXIgLSBUaGUgT1VUUFVUIGRpcmVjdG9yeSBmb3IgdGhlIGxheWVyIChlLmcuLCBkaXN0L2xheWVycy9kaSlcbiAqIEBwYXJhbSBleHRlcm5hbFBhY2thZ2VzIC0gQXJyYXkgb2YgcGFja2FnZSBuYW1lcyB0byBpbnN0YWxsIChlLmcuLCBbJ2F4aW9zJywgJ2ZpcmViYXNlLWFkbWluJ10pXG4gKiBAcGFyYW0gbG9nZ2VyIC0gTG9nZ2VyIGluc3RhbmNlIGZvciBvdXRwdXRcbiAqL1xuYXN5bmMgZnVuY3Rpb24gaW5zdGFsbEV4dGVybmFsRGVwZW5kZW5jaWVzT3B0aW1pemVkKGxheWVyT3V0cHV0RGlyOiBzdHJpbmcsIGV4dGVybmFsUGFja2FnZXM6IChzdHJpbmcgfCBSZWdFeHApW10sIGxvZ2dlcjogYW55KSB7XG4gICAgLy8gRmlsdGVyIG91dCByZWdleCBwYXR0ZXJucywgZnJhbWV3b3JrIHBhY2thZ2VzLCBhbmQgcGFja2FnZXMgcHJvdmlkZWQgYnkgb3RoZXIgbGF5ZXJzXG4gICAgY29uc3QgcGFja2FnZU5hbWVzID0gZXh0ZXJuYWxQYWNrYWdlcy5maWx0ZXIocGtnID0+IFxuICAgICAgICB0eXBlb2YgcGtnID09PSAnc3RyaW5nJyAmJiBcbiAgICAgICAgIXBrZy5zdGFydHNXaXRoKCdAYXdzLXNkaycpICYmICAgICAgLy8gUHJvdmlkZWQgYnkgTGFtYmRhIHJ1bnRpbWVcbiAgICAgICAgIXBrZy5zdGFydHNXaXRoKCdAc21pdGh5JykgJiYgICAgICAgLy8gUHJvdmlkZWQgYnkgTGFtYmRhIHJ1bnRpbWVcbiAgICAgICAgIXBrZy5zdGFydHNXaXRoKCdhd3MtY2RrLWxpYicpICYmICAgLy8gQnVpbGQtdGltZSBvbmx5XG4gICAgICAgIHBrZyAhPT0gJ2VzYnVpbGQnICYmICAgICAgICAgICAgICAgIC8vIEJ1aWxkLXRpbWUgb25seVxuICAgICAgICBwa2cgIT09ICdAdGVuMjRncm91cC9mdzI0JyAgICAgICAgICAvLyBQcm92aWRlZCBieSBmdzI0IHJ1bnRpbWUgbGF5ZXJcbiAgICApIGFzIHN0cmluZ1tdO1xuXG4gICAgaWYgKHBhY2thZ2VOYW1lcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IG5vZGVqc0RpciA9IHBhdGhKb2luKGxheWVyT3V0cHV0RGlyLCAnbm9kZWpzJyk7XG4gICAgY29uc3Qgbm9kZU1vZHVsZXNEaXIgPSBwYXRoSm9pbihub2RlanNEaXIsICdub2RlX21vZHVsZXMnKTtcbiAgICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSBwYXRoSm9pbihub2RlanNEaXIsICdwYWNrYWdlLmpzb24nKTtcbiAgICBjb25zdCBwYWNrYWdlSGFzaFBhdGggPSBwYXRoSm9pbihub2RlanNEaXIsICcucGFja2FnZS1oYXNoJyk7XG4gICAgXG4gICAgLy8gQnVpbGQgZGVzaXJlZCBwYWNrYWdlLmpzb25cbiAgICBjb25zdCBwYWNrYWdlSnNvbjogYW55ID0ge1xuICAgICAgICBuYW1lOiAnbGF5ZXItZGVwZW5kZW5jaWVzJyxcbiAgICAgICAgdmVyc2lvbjogJzEuMC4wJyxcbiAgICAgICAgZGVwZW5kZW5jaWVzOiB7fVxuICAgIH07XG5cbiAgICAvLyBSZWFkIHRoZSBwcm9qZWN0J3MgcGFja2FnZS5qc29uIHRvIGdldCB2ZXJzaW9uIG51bWJlcnNcbiAgICBjb25zdCBwcm9qZWN0Um9vdCA9IHBhdGhSZXNvbHZlKHByb2Nlc3MuY3dkKCkpO1xuICAgIGNvbnN0IHByb2plY3RQYWNrYWdlSnNvblBhdGggPSBwYXRoSm9pbihwcm9qZWN0Um9vdCwgJ3BhY2thZ2UuanNvbicpO1xuICAgIFxuICAgIGlmICghZXhpc3RzU3luYyhwcm9qZWN0UGFja2FnZUpzb25QYXRoKSkge1xuICAgICAgICBsb2dnZXIud2FybihgcGFja2FnZS5qc29uIG5vdCBmb3VuZCBhdCAke3Byb2plY3RQYWNrYWdlSnNvblBhdGh9LCBpbnN0YWxsaW5nIGxhdGVzdCB2ZXJzaW9uc2ApO1xuICAgICAgICBwYWNrYWdlTmFtZXMuZm9yRWFjaChwa2cgPT4ge1xuICAgICAgICAgICAgcGFja2FnZUpzb24uZGVwZW5kZW5jaWVzW3BrZ10gPSAnbGF0ZXN0JztcbiAgICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgcHJvamVjdFBhY2thZ2VKc29uID0gSlNPTi5wYXJzZShyZWFkRmlsZVN5bmMocHJvamVjdFBhY2thZ2VKc29uUGF0aCwgJ3V0Zi04JykpO1xuICAgICAgICAvLyBPTkxZIHVzZSBydW50aW1lIGRlcGVuZGVuY2llcyAtIGRldkRlcGVuZGVuY2llcyBhcmUgYnVpbGQtdGltZSB0b29scywgbm90IExhbWJkYSBydW50aW1lIVxuICAgICAgICBjb25zdCBydW50aW1lRGVwcyA9IHByb2plY3RQYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXMgfHwge307XG5cbiAgICAgICAgcGFja2FnZU5hbWVzLmZvckVhY2gocGtnID0+IHtcbiAgICAgICAgICAgIGlmIChydW50aW1lRGVwc1twa2ddKSB7XG4gICAgICAgICAgICAgICAgbGV0IGRlcFZhbHVlID0gcnVudGltZURlcHNbcGtnXTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBIYW5kbGUgbG9jYWwgZmlsZXN5c3RlbSBkZXBlbmRlbmNpZXMgKGUuZy4sIFwiLi4vZncyNC9cIiBvciBcImZpbGU6Li4vZncyNFwiKVxuICAgICAgICAgICAgICAgIGlmIChkZXBWYWx1ZS5zdGFydHNXaXRoKCdmaWxlOicpIHx8IGRlcFZhbHVlLnN0YXJ0c1dpdGgoJy4uLycpIHx8IGRlcFZhbHVlLnN0YXJ0c1dpdGgoJy4vJykpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbG9jYWxQYXRoID0gZGVwVmFsdWUucmVwbGFjZSgnZmlsZTonLCAnJyk7XG4gICAgICAgICAgICAgICAgICAgIC8vIFJlc29sdmUgYWJzb2x1dGUgcGF0aCBvZiB0aGUgbG9jYWwgcGFja2FnZVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSBwYXRoUmVzb2x2ZShwcm9qZWN0Um9vdCwgbG9jYWxQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlmIChleGlzdHNTeW5jKGFic29sdXRlUGF0aCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENhbGN1bGF0ZSByZWxhdGl2ZSBwYXRoIGZyb20gbm9kZWpzRGlyIHRvIHRoZSBsb2NhbCBwYWNrYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZWxhdGl2ZVBhdGhGcm9tTGF5ZXIgPSBwYXRoUmVsYXRpdmUobm9kZWpzRGlyLCBhYnNvbHV0ZVBhdGgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVwVmFsdWUgPSByZWxhdGl2ZVBhdGhGcm9tTGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4oaSIFJlc29sdmVkIGxvY2FsIHBhY2thZ2UgXCIke3BrZ31cIjogJHtyZWxhdGl2ZVBhdGhGcm9tTGF5ZXJ9YCk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXIud2Fybihg4pqg77iPICBMb2NhbCBwYWNrYWdlIHBhdGggbm90IGZvdW5kOiAke2Fic29sdXRlUGF0aH1gKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBwYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXNbcGtnXSA9IGRlcFZhbHVlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsb2dnZXIud2Fybihg4pqg77iPICBQYWNrYWdlIFwiJHtwa2d9XCIgbm90IGZvdW5kIGluIHJ1bnRpbWUgZGVwZW5kZW5jaWVzYCk7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYCAgIEFkZCBcIiR7cGtnfVwiIHRvIGRlcGVuZGVuY2llcyBpbiBwYWNrYWdlLmpzb24gb3IgaXQgd2lsbCB1c2UgJ2xhdGVzdCdgKTtcbiAgICAgICAgICAgICAgICBwYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXNbcGtnXSA9ICdsYXRlc3QnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBwYWNrYWdlSnNvbkNvbnRlbnQgPSBKU09OLnN0cmluZ2lmeShwYWNrYWdlSnNvbiwgbnVsbCwgMik7XG4gICAgY29uc3QgY3VycmVudFBhY2thZ2VIYXNoID0gY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKHBhY2thZ2VKc29uQ29udGVudCkuZGlnZXN0KCdoZXgnKTtcbiAgICBcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvLyBGQVNUIFBBVEg6IENoZWNrIGlmIHdlIGNhbiBza2lwIG5wbSBpbnN0YWxsXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgaWYgKGV4aXN0c1N5bmMocGFja2FnZUhhc2hQYXRoKSAmJiBleGlzdHNTeW5jKG5vZGVNb2R1bGVzRGlyKSkge1xuICAgICAgICBjb25zdCBwcmV2aW91c0hhc2ggPSByZWFkRmlsZVN5bmMocGFja2FnZUhhc2hQYXRoLCAndXRmLTgnKS50cmltKCk7XG4gICAgICAgIGlmIChwcmV2aW91c0hhc2ggPT09IGN1cnJlbnRQYWNrYWdlSGFzaCkge1xuICAgICAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKckyBEZXBlbmRlbmNpZXMgYWxyZWFkeSBpbnN0YWxsZWQsIHNraXBwaW5nIG5wbSBpbnN0YWxsYCk7XG4gICAgICAgICAgICByZXR1cm47IC8vIFNBVkVEIDExKyBTRUNPTkRTIVxuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIFNMT1cgUEFUSDogTmVlZCB0byBydW4gbnBtIGluc3RhbGxcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICBsb2dnZXIuaW5mbyhgICAgSW5zdGFsbGluZyAke3BhY2thZ2VOYW1lcy5sZW5ndGh9IHBhY2thZ2VzOiAke3BhY2thZ2VOYW1lcy5qb2luKCcsICcpfWApO1xuICAgIFxuICAgIGNvbnN0IGluc3RhbGxTdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgLy8gRW5zdXJlIGRpcmVjdG9yeSBleGlzdHNcbiAgICBpZiAoIWV4aXN0c1N5bmMobm9kZWpzRGlyKSkge1xuICAgICAgICBta2RpclN5bmMobm9kZWpzRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICB9XG5cbiAgICAvLyBXcml0ZSBwYWNrYWdlLmpzb25cbiAgICB3cml0ZUZpbGVTeW5jKHBhY2thZ2VKc29uUGF0aCwgcGFja2FnZUpzb25Db250ZW50KTtcblxuICAgIC8vIEluc3RhbGwgZGVwZW5kZW5jaWVzXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gLS1pbnN0YWxsLWxpbmtzIGlzIG5lZWRlZCB0byBpbnN0YWxsIGxvY2FsIHBhY2thZ2VzIGZyb20gZmlsZTogcmVmZXJlbmNlc1xuICAgICAgICAvLyAtLXByZWZlci1vZmZsaW5lIGlzIG5lZWRlZCB0byBzcGVlZCB1cCB0aGUgaW5zdGFsbGF0aW9uXG4gICAgICAgIC8vIC0tbm8tcGFja2FnZS1sb2NrIGlzIG5lZWRlZCB0byBhdm9pZCBwYWNrYWdlLWxvY2suanNvbiBjb25mbGljdHNcbiAgICAgICAgLy8gLS1vbWl0PWRldiBpcyBuZWVkZWQgdG8gYXZvaWQgaW5zdGFsbGluZyBkZXYgZGVwZW5kZW5jaWVzXG4gICAgICAgIGV4ZWNTeW5jKCducG0gaW5zdGFsbCAtLW9taXQ9ZGV2IC0tbm8tcGFja2FnZS1sb2NrIC0taW5zdGFsbC1saW5rcyAtLXByZWZlci1vZmZsaW5lJywge1xuICAgICAgICAgICAgY3dkOiBub2RlanNEaXIsXG4gICAgICAgICAgICBzdGRpbzogJ2luaGVyaXQnXG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgZWxhcHNlZCA9ICgoRGF0ZS5ub3coKSAtIGluc3RhbGxTdGFydFRpbWUpIC8gMTAwMCkudG9GaXhlZCgxKTtcbiAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKckyBucG0gaW5zdGFsbCBjb21wbGV0ZSBpbiAke2VsYXBzZWR9c2ApO1xuICAgICAgICBcbiAgICAgICAgLy8gU2F2ZSBoYXNoIGZvciBuZXh0IHJ1blxuICAgICAgICB3cml0ZUZpbGVTeW5jKHBhY2thZ2VIYXNoUGF0aCwgY3VycmVudFBhY2thZ2VIYXNoKTtcbiAgICAgICAgXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gaW5zdGFsbCBleHRlcm5hbCBkZXBlbmRlbmNpZXM6JywgZXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG59XG5cbi8qKlxuICogUmVjdXJzaXZlbHkgY29weSBhIGRpcmVjdG9yeVxuICovXG5mdW5jdGlvbiBjb3B5RGlyZWN0b3J5KHNvdXJjZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZykge1xuICAgIGlmICghZXhpc3RzU3luYyh0YXJnZXQpKSB7XG4gICAgICAgIG1rZGlyU3luYyh0YXJnZXQsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cbiAgICBjb25zdCBpdGVtcyA9IHJlYWRkaXJTeW5jKHNvdXJjZSk7XG4gICAgaXRlbXMuZm9yRWFjaChpdGVtID0+IHtcbiAgICAgICAgY29uc3Qgc291cmNlUGF0aCA9IHBhdGhKb2luKHNvdXJjZSwgaXRlbSk7XG4gICAgICAgIGNvbnN0IHRhcmdldFBhdGggPSBwYXRoSm9pbih0YXJnZXQsIGl0ZW0pO1xuICAgICAgICBpZiAobHN0YXRTeW5jKHNvdXJjZVBhdGgpLmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIGNvcHlEaXJlY3Rvcnkoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb3B5RmlsZVN5bmMoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCk7XG4gICAgICAgIH1cbiAgICB9KTtcbn1cbiJdfQ==