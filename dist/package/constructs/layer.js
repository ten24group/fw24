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
const timer_1 = require("../utils/timer");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const node_child_process_1 = require("node:child_process");
const esbuild_1 = require("esbuild");
const decorators_1 = require("../decorators");
const node_crypto_1 = require("node:crypto");
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
        for (const layerConfig of config) {
            layerConfig.mode = layerConfig.mode || 'PACKAGE_DIRECTORY';
            if (layerConfig.mode === 'BUILD_AND_PACKAGE') {
                layerConfig.clearOutputDir = layerConfig.clearOutputDir ?? false;
            }
        }
        helper_1.Helper.hydrateConfig(config, 'LAYER');
    }
    async construct() {
        // Assign priority to each layer: use explicit priority if set, otherwise use array index + 10
        // Priority 0-9 reserved for framework layers (fw24 core = 0)
        // User layers start at 10+ to ensure framework layers always load first
        for (const [index, layerConfig] of this.config.entries()) {
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
            }
            else if (layerConfig.mode === 'BUILD_AND_PACKAGE') {
                await this.scanAndPackageFiles(layerConfig);
            }
            else {
                throw new Error(`Invalid mode for layer ${JSON.stringify(layerConfig)}`);
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
        const distDirectory = layerConfig.distDirectory || (0, node_path_1.join)(process.cwd(), 'dist/layers');
        const sourceDirectoryOrFileName = (0, node_path_1.resolve)(layerConfig.sourcePath);
        const tsFiles = (0, node_fs_1.lstatSync)(sourceDirectoryOrFileName).isDirectory()
            ? scanDirectory(sourceDirectoryOrFileName)
            : [sourceDirectoryOrFileName];
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
    async tryCreateLayerForFile(file, distDirectory, layerConfig) {
        const fileBaseName = (0, node_path_1.basename)(file, (0, node_path_1.extname)(file));
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
        const outputDir = (0, node_path_1.join)(distDirectory, layerName, configuredOutputPath);
        const bundleDir = (0, node_path_1.join)(distDirectory, layerName);
        // ═══════════════════════════════════════════════════════════════
        // BUILD LAYER: esbuild + npm install (with npm install caching)
        // ═══════════════════════════════════════════════════════════════
        this.logger.info(`[${layerName}] Building layer...`);
        const buildTimer = timer_1.Timer.start();
        // Ensure output directory exists
        if (!(0, node_fs_1.existsSync)(outputDir)) {
            (0, node_fs_1.mkdirSync)(outputDir, { recursive: true });
        }
        // Install external dependencies FIRST (with smart caching to skip if unchanged)
        const externalPackages = (buildOptions.external && Array.isArray(buildOptions.external)) ? buildOptions.external : [];
        if (externalPackages.length > 0) {
            const installTimer = timer_1.Timer.start();
            this.logger.info(`[${layerName}] [1/2] Installing external dependencies...`);
            await installExternalDependenciesOptimized(bundleDir, externalPackages, this.logger);
            this.logger.info(`[${layerName}]    ✓ Dependencies installed (${installTimer.elapsedSeconds()})`);
        }
        // Then bundle application code into node_modules
        const outputFile = (0, node_path_1.join)(outputDir, 'index.js');
        const bundleTimer = timer_1.Timer.start();
        this.logger.info(`[${layerName}] [2/2] Bundling with esbuild...`);
        await bundleWithEsbuild(file, outputFile, buildOptions);
        this.logger.info(`[${layerName}]    ✓ Bundle complete (${bundleTimer.elapsedSeconds()})`);
        this.logger.info(`[${layerName}] ✓ Build complete in ${buildTimer.elapsedSeconds()}`);
        // Import path: /opt/nodejs/node_modules/{packageName}/index.js
        // Node.js will resolve this to the bundled entry point
        const layerImportPath = (0, node_path_1.join)('/opt', configuredOutputPath, 'index.js');
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
    const items = (0, node_fs_1.readdirSync)(directory);
    for (const item of items) {
        const fullPath = (0, node_path_1.join)(directory, item);
        const stat = (0, node_fs_1.statSync)(fullPath);
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
    try {
        await (0, esbuild_1.build)(finalOptions);
    }
    catch (error) {
        logging_1.DefaultLogger.error(`Failed to bundle ${entryFile}:`, error);
        throw new Error(`esbuild failed for ${entryFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Calculates hash of a file's contents
 */
function calculateFileHash(filePath) {
    const content = (0, node_fs_1.readFileSync)(filePath);
    return (0, node_crypto_1.createHash)('sha256').update(content).digest('hex');
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
function hashDirectoryContents(dirPath) {
    const hash = (0, node_crypto_1.createHash)('sha256');
    let fileCount = 0;
    const hashDirRecursive = (currentPath) => {
        if (!(0, node_fs_1.existsSync)(currentPath))
            return;
        const stat = (0, node_fs_1.lstatSync)(currentPath);
        if (stat.isSymbolicLink()) {
            // Skip symlinks to avoid infinite loops and inconsistent behavior
            return;
        }
        if (stat.isDirectory()) {
            const items = (0, node_fs_1.readdirSync)(currentPath).sort((a, b) => a.localeCompare(b)); // Sort for deterministic hashing
            for (const item of items) {
                // Skip common directories that don't affect runtime
                if (item === 'node_modules' || item === '.git' ||
                    item === 'test' || item === '__tests__' ||
                    item === 'coverage' || item === '.DS_Store') {
                    return;
                }
                hashDirRecursive((0, node_path_1.join)(currentPath, item));
            }
        }
        else if (stat.isFile()) {
            fileCount++;
            // Hash file path (relative) for uniqueness
            const relativePath = (0, node_path_1.relative)(dirPath, currentPath);
            hash.update(relativePath);
            // Hash file contents
            hash.update((0, node_fs_1.readFileSync)(currentPath));
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
function cleanupDirectory(directory) {
    try {
        (0, node_fs_1.rmSync)(directory, { recursive: true, force: true });
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
        pkg !== '@ten24group/fw24' // Provided by fw24 runtime layer (not di layer)
    );
    if (packageNames.length === 0) {
        return;
    }
    const nodejsDir = (0, node_path_1.join)(layerOutputDir, 'nodejs');
    const nodeModulesDir = (0, node_path_1.join)(nodejsDir, 'node_modules');
    const packageJsonPath = (0, node_path_1.join)(nodejsDir, 'package.json');
    const packageHashPath = (0, node_path_1.join)(nodejsDir, '.package-hash');
    // Build desired package.json
    const packageJson = {
        name: 'layer-dependencies',
        version: '1.0.0',
        dependencies: {}
    };
    // Read the project's package.json to get version numbers
    const projectRoot = (0, node_path_1.resolve)(process.cwd());
    const projectPackageJsonPath = (0, node_path_1.join)(projectRoot, 'package.json');
    // Track local package content hashes for change detection
    const localPackageHashes = {};
    if (!(0, node_fs_1.existsSync)(projectPackageJsonPath)) {
        logger.warn(`package.json not found at ${projectPackageJsonPath}, installing latest versions`);
        for (const pkg of packageNames) {
            packageJson.dependencies[pkg] = 'latest';
        }
    }
    else {
        const projectPackageJson = JSON.parse((0, node_fs_1.readFileSync)(projectPackageJsonPath, 'utf-8'));
        // ONLY use runtime dependencies - devDependencies are build-time tools, not Lambda runtime!
        const runtimeDeps = projectPackageJson.dependencies || {};
        for (const pkg of packageNames) {
            if (runtimeDeps[pkg]) {
                let depValue = runtimeDeps[pkg];
                // Handle local filesystem dependencies (e.g., "../fw24/", "file:../fw24", or "..\fw24" on Windows)
                const isLocalDep = depValue.startsWith('file:') ||
                    depValue.startsWith('../') ||
                    depValue.startsWith('./') ||
                    depValue.startsWith('..\\') ||
                    depValue.startsWith('.\\');
                if (isLocalDep) {
                    const localPath = depValue.replace('file:', '');
                    // Resolve absolute path of the local package
                    const absolutePath = (0, node_path_1.resolve)(projectRoot, localPath);
                    // Validate local package exists
                    if (!(0, node_fs_1.existsSync)(absolutePath)) {
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
                    const distPath = (0, node_path_1.join)(absolutePath, 'dist');
                    if (!(0, node_fs_1.existsSync)(distPath)) {
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
                    localPackageHashes[pkg] = contentHash;
                    logger.info(`   → Local package "${pkg}" hash: ${contentHash.substring(0, 12)}... (${pkg})`);
                    // Calculate relative path from layer's nodejs dir to local package
                    const relativePathFromLayer = (0, node_path_1.relative)(nodejsDir, absolutePath);
                    depValue = relativePathFromLayer;
                    logger.info(`   → Resolved local package "${pkg}": ${relativePathFromLayer}`);
                }
                packageJson.dependencies[pkg] = depValue;
            }
            else {
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
        }
        ;
    }
    const packageJsonContent = JSON.stringify(packageJson, null, 2);
    const hash = (0, node_crypto_1.createHash)('sha256');
    hash.update(packageJsonContent);
    // CRITICAL: Include local package content hashes in the cache key
    // This ensures we reinstall when local packages change (e.g., fw24 updates)
    if (Object.keys(localPackageHashes).length > 0) {
        logger.debug(`   → Including ${Object.keys(localPackageHashes).length} local package content hashes in cache key`);
        for (const pkg of Object.keys(localPackageHashes).sort((a, b) => a.localeCompare(b))) {
            hash.update(`${pkg}:${localPackageHashes[pkg]}`);
        }
    }
    const currentPackageHash = hash.digest('hex');
    // ═══════════════════════════════════════════════════════════════
    // FAST PATH: Check if we can skip npm install
    // ═══════════════════════════════════════════════════════════════
    let skipReason = null;
    if (!(0, node_fs_1.existsSync)(packageHashPath)) {
        skipReason = 'No previous hash file found (first build)';
    }
    else if (!(0, node_fs_1.existsSync)(nodeModulesDir)) {
        skipReason = 'node_modules directory not found';
    }
    else {
        try {
            const previousHash = (0, node_fs_1.readFileSync)(packageHashPath, 'utf-8').trim();
            // Validate hash format (SHA-256 = 64 hex chars)
            if (previousHash.length !== 64 || !/^[0-9a-f]{64}$/.test(previousHash)) {
                skipReason = `Invalid hash format in cache file (got ${previousHash.length} chars)`;
            }
            else if (previousHash === currentPackageHash) {
                logger.info(`   ✓ Dependencies unchanged, skipping npm install (saved ~11s)`);
                return; // FAST PATH SUCCESS!
            }
            else {
                skipReason = 'Dependency changes detected';
                logger.info(`   → Previous hash: ${previousHash.substring(0, 12)}...`);
                logger.info(`   → Current hash:  ${currentPackageHash.substring(0, 12)}...`);
                if (Object.keys(localPackageHashes).length > 0) {
                    logger.info(`   → Local packages included in hash: ${Object.keys(localPackageHashes).join(', ')}`);
                }
            }
        }
        catch (error) {
            skipReason = `Failed to read hash file: ${error.message}`;
        }
    }
    // ═══════════════════════════════════════════════════════════════
    // SLOW PATH: Need to run npm install
    // ═══════════════════════════════════════════════════════════════
    logger.info(`   📦 Running npm install (reason: ${skipReason})`);
    logger.info(`   → Installing ${packageNames.length} package(s): ${packageNames.join(', ')}`);
    const installStartTime = Date.now();
    // Ensure directory exists
    if (!(0, node_fs_1.existsSync)(nodejsDir)) {
        (0, node_fs_1.mkdirSync)(nodejsDir, { recursive: true });
    }
    // Write package.json
    (0, node_fs_1.writeFileSync)(packageJsonPath, packageJsonContent);
    // Install dependencies
    try {
        // --install-links is needed to install local packages from file: references
        // --prefer-offline is needed to speed up the installation
        // --no-package-lock is needed to avoid package-lock.json conflicts
        // --omit=dev is needed to avoid installing dev dependencies
        (0, node_child_process_1.execSync)('npm install --omit=dev --no-package-lock --install-links --prefer-offline', {
            cwd: nodejsDir,
            stdio: 'inherit'
        });
        const elapsed = ((Date.now() - installStartTime) / 1000).toFixed(1);
        logger.info(`   ✓ npm install complete in ${elapsed}s`);
        // Save hash for next run
        (0, node_fs_1.writeFileSync)(packageHashPath, currentPackageHash);
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
    if (!(0, node_fs_1.existsSync)(target)) {
        (0, node_fs_1.mkdirSync)(target, { recursive: true });
    }
    const items = (0, node_fs_1.readdirSync)(source);
    for (const item of items) {
        const sourcePath = (0, node_path_1.join)(source, item);
        const targetPath = (0, node_path_1.join)(target, item);
        if ((0, node_fs_1.lstatSync)(sourcePath).isDirectory()) {
            copyDirectory(sourcePath, targetPath);
        }
        else {
            (0, node_fs_1.copyFileSync)(sourcePath, targetPath);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGF5ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9sYXllci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUF1ZkEsc0NBRUM7QUF2ZkQsMkNBQXdDO0FBQ3hDLHVDQUFvQztBQUNwQyx1REFBeUY7QUFDekYsd0NBQStFO0FBQy9FLDBDQUF1QztBQUN2Qyx1REFBc0c7QUFDdEcseUNBQWlKO0FBQ2pKLHFDQUFxSTtBQUNySSwyREFBOEM7QUFDOUMscUNBQThDO0FBQzlDLDhDQUEyQztBQUUzQyw2Q0FBeUM7QUFDekMsMENBQXVDO0FBbUl2Qzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBMkJHO0FBQ0gsTUFBYSxjQUFjO0lBY007SUFicEIsTUFBTSxDQUFVO0lBQ2hCLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUM7SUFDM0IsWUFBWSxHQUFhLEVBQUUsQ0FBQztJQUM1QixNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUVsQjs7O09BR0c7SUFDSCxZQUE2QixNQUErQixFQUFFLFVBQW9CO1FBQXJELFdBQU0sR0FBTixNQUFNLENBQXlCO1FBRXhELElBQUcsVUFBVSxFQUFDLENBQUM7WUFDWCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxjQUFjLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ3ZELENBQUM7YUFBTSxDQUFDO1lBQ0osSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3BELENBQUM7UUFFRCxlQUFlO1FBQ2YsS0FBSSxNQUFNLFdBQVcsSUFBSSxNQUFNLEVBQUUsQ0FBQztZQUM5QixXQUFXLENBQUMsSUFBSSxHQUFHLFdBQVcsQ0FBQyxJQUFJLElBQUksbUJBQW1CLENBQUM7WUFDM0QsSUFBSSxXQUFXLENBQUMsSUFBSSxLQUFLLG1CQUFtQixFQUFFLENBQUM7Z0JBQzNDLFdBQVcsQ0FBQyxjQUFjLEdBQUcsV0FBVyxDQUFDLGNBQWMsSUFBSSxLQUFLLENBQUM7WUFDckUsQ0FBQztRQUNMLENBQUM7UUFFRCxlQUFNLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQztJQUMxQyxDQUFDO0lBR1ksQUFBTixLQUFLLENBQUMsU0FBUztRQUNsQiw4RkFBOEY7UUFDOUYsNkRBQTZEO1FBQzdELHdFQUF3RTtRQUN4RSxLQUFJLE1BQU0sQ0FBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDO1lBQ3RELElBQUksQ0FBQyxXQUFXLENBQUMsUUFBUSxJQUFJLFdBQVcsQ0FBQyxRQUFRLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3RELFdBQVcsQ0FBQyxRQUFRLEdBQUcsS0FBSyxHQUFHLEVBQUUsQ0FBQztZQUN0QyxDQUFDO1FBQ0wsQ0FBQztRQUVELHFGQUFxRjtRQUNyRixNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLFdBQVcsRUFBRSxFQUFFO1lBQ3BELElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLGNBQWMsRUFBRSxXQUFXLENBQUMsZUFBZSxDQUFDLENBQUM7WUFFaEksSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsbUJBQW1CLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFFcEQsSUFBSSxXQUFXLENBQUMsSUFBSSxLQUFLLG1CQUFtQixFQUFFLENBQUM7Z0JBQzNDLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBQzdDLENBQUM7aUJBQU0sSUFBSSxXQUFXLENBQUMsSUFBSSxLQUFLLG1CQUFtQixFQUFFLENBQUM7Z0JBQ2xELE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBQ2hELENBQUM7aUJBQU0sQ0FBQztnQkFDSixNQUFNLElBQUksS0FBSyxDQUFDLDBCQUEwQixJQUFJLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUM3RSxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNSLENBQUM7SUFFRDs7OztPQUlHO0lBQ0ssS0FBSyxDQUFDLGdCQUFnQixDQUFDLFdBQW9DO1FBQy9ELE1BQU0saUJBQWlCLEdBQXNCO1lBQ3pDLGdCQUFnQixFQUFFLFdBQVcsQ0FBQyxTQUFTO1lBQ3ZDLGtCQUFrQixFQUFFLENBQUUsb0JBQU8sQ0FBQyxXQUFXLENBQUU7WUFDM0MsSUFBSSxFQUFFLGlCQUFJLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxVQUFVLENBQUM7WUFDNUMsdUJBQXVCLEVBQUUsQ0FBQyx5QkFBWSxDQUFDLE1BQU0sQ0FBQztTQUNqRCxDQUFDO1FBRUYsTUFBTSxLQUFLLEdBQUcsSUFBSSx5QkFBWSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsV0FBVyxDQUFDLFNBQVMsR0FBRyxRQUFRLEVBQUU7WUFDN0UsR0FBRyxpQkFBaUI7WUFDcEIsR0FBRyxXQUFXLENBQUMsVUFBVTtTQUM1QixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksRUFBRSxXQUFXLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxzQkFBVSxDQUFDLEtBQUssRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO0lBRTFHLENBQUM7SUFHRDs7OztPQUlHO0lBQ0ssS0FBSyxDQUFDLG1CQUFtQixDQUFDLFdBQW1DO1FBQ2pFLHlGQUF5RjtRQUN6RixNQUFNLGFBQWEsR0FBRyxXQUFXLENBQUMsYUFBYSxJQUFJLElBQUEsZ0JBQVEsRUFBQyxPQUFPLENBQUMsR0FBRyxFQUFFLEVBQUUsYUFBYSxDQUFDLENBQUM7UUFDMUYsTUFBTSx5QkFBeUIsR0FBRyxJQUFBLG1CQUFXLEVBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3RFLE1BQU0sT0FBTyxHQUFHLElBQUEsbUJBQVMsRUFBQyx5QkFBeUIsQ0FBQyxDQUFDLFdBQVcsRUFBRTtZQUM5RCxDQUFDLENBQUMsYUFBYSxDQUFDLHlCQUF5QixDQUFDO1lBQzFDLENBQUMsQ0FBQyxDQUFDLHlCQUF5QixDQUFDLENBQUM7UUFFbEMscUVBQXFFO1FBQ3JFLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsRUFBRTtZQUN6QyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1FBQ3ZFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDUixDQUFDO0lBR0Q7Ozs7OztPQU1HO0lBQ0ssaUJBQWlCLENBQ3JCLFNBQWlCLEVBQ2pCLHFCQUFvQyxFQUNwQyxxQkFBb0M7UUFFcEMsdUNBQXVDO1FBQ3ZDLE1BQU0sbUJBQW1CLEdBQWlCO1lBQ3RDLE1BQU0sRUFBRSxJQUFJO1lBQ1osUUFBUSxFQUFFLE1BQU07WUFDaEIsTUFBTSxFQUFFLFFBQVE7WUFDaEIsTUFBTSxFQUFFLEtBQUs7WUFDYixTQUFTLEVBQUUsS0FBSztZQUNoQixRQUFRLEVBQUU7Z0JBQ04sb0RBQW9EO2dCQUNwRCxrQkFBa0I7Z0JBQ2xCLDBCQUEwQjtnQkFDMUIsVUFBVTtnQkFDVixTQUFTO2dCQUNULGFBQWE7Z0JBQ2IsU0FBUzthQUNaO1NBQ0osQ0FBQztRQUVGLDJDQUEyQztRQUMzQyxNQUFNLE1BQU0sR0FBRyxDQUFDLElBQUEsYUFBSyxFQUFDO1lBQ2xCLG1CQUFtQjtZQUNuQixxQkFBcUIsSUFBSSxFQUFFO1lBQzNCLHFCQUFxQixJQUFJLEVBQUU7U0FDOUIsQ0FBQyxJQUFJLG1CQUFtQixDQUFDLENBQUM7UUFFM0IsMkJBQTJCO1FBQzNCLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksU0FBUyx5QkFBeUIsRUFBRTtZQUN0RCxTQUFTLEVBQUUsTUFBTSxDQUFDLFNBQVM7WUFDM0IsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO1lBQ3JCLFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUTtZQUN6QixRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVE7WUFDekIsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO1NBQ3hCLENBQUMsQ0FBQztRQUVILE9BQU8sTUFBTSxDQUFDO0lBQ2xCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSyxLQUFLLENBQUMscUJBQXFCLENBQUMsSUFBWSxFQUFFLGFBQXFCLEVBQUUsV0FBbUM7UUFDeEcsTUFBTSxZQUFZLEdBQUcsSUFBQSxvQkFBWSxFQUFDLElBQUksRUFBRSxJQUFBLG1CQUFXLEVBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUMzRCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsWUFBWSxFQUFFLENBQUMsQ0FBQztRQUV0RCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsSUFBSSxLQUFLLENBQUMsQ0FBQztRQUM5RCxNQUFNLGFBQWEsR0FBRyx5QkFBYSxJQUFJLHVDQUFDLENBQUM7UUFDekMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMseUJBQXlCLENBQUMsQ0FBQztRQUU3QyxNQUFNLHdCQUF3QixHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUU7WUFDckUsTUFBTSxRQUFRLEdBQUcsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3BDLElBQUksT0FBTyxRQUFRLEtBQUssVUFBVSxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO2dCQUMzRCxPQUFPLFFBQVEsQ0FBQztZQUNwQixDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFHLENBQUMsd0JBQXdCLEVBQUMsQ0FBQztZQUMxQixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQywrQkFBK0IsSUFBSSw2QkFBNkIsQ0FBQyxDQUFDO1FBQ3ZGLENBQUM7UUFFRCxJQUFBLHVCQUFVLEVBQUM7WUFDUCxTQUFTLEVBQUUsV0FBVyxDQUFDLFNBQVMsSUFBSSxLQUFLO1lBQ3pDLGNBQWMsRUFBRSxXQUFXLENBQUMsY0FBYyxJQUFJLEtBQUs7U0FDdEQsQ0FBQyxDQUFBO1FBQ0YsTUFBTSxvQkFBb0I7U0FBRztRQUU3QixpR0FBaUc7UUFDakcsTUFBTSxlQUFlLEdBQUcsd0JBQXdCLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQztRQUVsSCxNQUFNLFNBQVMsR0FBRyxZQUFZLENBQUMsZUFBZSxDQUFDLElBQUksWUFBWSxDQUFDO1FBRWhFLG9FQUFvRTtRQUNwRSxNQUFNLHFCQUFxQixHQUFHLG9CQUFvQixDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBQ3BFLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FDdkMsU0FBUyxFQUNULFdBQVcsQ0FBQyxZQUFZLEVBQ3hCLHFCQUFxQixDQUN4QixDQUFDO1FBRUYsK0JBQStCO1FBQy9CLG1GQUFtRjtRQUNuRix3RUFBd0U7UUFDeEUsTUFBTSxXQUFXLEdBQUcsV0FBVyxDQUFDLFdBQVcsSUFBSSxZQUFZLENBQUM7UUFDNUQsTUFBTSxvQkFBb0IsR0FBRyx1QkFBdUIsV0FBVyxFQUFFLENBQUM7UUFFbEUsTUFBTSxTQUFTLEdBQUcsSUFBQSxnQkFBUSxFQUFDLGFBQWEsRUFBRSxTQUFTLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUMzRSxNQUFNLFNBQVMsR0FBRyxJQUFBLGdCQUFRLEVBQUMsYUFBYSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBRXJELGtFQUFrRTtRQUNsRSxnRUFBZ0U7UUFDaEUsa0VBQWtFO1FBQ2xFLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksU0FBUyxxQkFBcUIsQ0FBQyxDQUFDO1FBQ3JELE1BQU0sVUFBVSxHQUFHLGFBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUVqQyxpQ0FBaUM7UUFDakMsSUFBSSxDQUFDLElBQUEsb0JBQVUsRUFBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQ3pCLElBQUEsbUJBQVMsRUFBQyxTQUFTLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUM5QyxDQUFDO1FBRUQsZ0ZBQWdGO1FBQ2hGLE1BQU0sZ0JBQWdCLEdBQUcsQ0FBQyxZQUFZLENBQUMsUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUN0SCxJQUFJLGdCQUFnQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUM5QixNQUFNLFlBQVksR0FBRyxhQUFLLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDbkMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxTQUFTLDZDQUE2QyxDQUFDLENBQUM7WUFDN0UsTUFBTSxvQ0FBb0MsQ0FBQyxTQUFTLEVBQUUsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ3JGLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksU0FBUyxrQ0FBa0MsWUFBWSxDQUFDLGNBQWMsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUN0RyxDQUFDO1FBRUQsaURBQWlEO1FBQ2pELE1BQU0sVUFBVSxHQUFHLElBQUEsZ0JBQVEsRUFBQyxTQUFTLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFDbkQsTUFBTSxXQUFXLEdBQUcsYUFBSyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ2xDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksU0FBUyxrQ0FBa0MsQ0FBQyxDQUFDO1FBQ2xFLE1BQU0saUJBQWlCLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRSxZQUFZLENBQUMsQ0FBQztRQUN4RCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLFNBQVMsMkJBQTJCLFdBQVcsQ0FBQyxjQUFjLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFFMUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxTQUFTLHlCQUF5QixVQUFVLENBQUMsY0FBYyxFQUFFLEVBQUUsQ0FBQyxDQUFBO1FBRXJGLCtEQUErRDtRQUMvRCx1REFBdUQ7UUFDdkQsTUFBTSxlQUFlLEdBQUcsSUFBQSxnQkFBUSxFQUFDLE1BQU0sRUFBRSxvQkFBb0IsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUMzRSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLFNBQVMsd0JBQXdCLGVBQWUsRUFBRSxDQUFDLENBQUM7UUFFekUsSUFBSSxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxTQUFTLEVBQUUsZUFBZSxFQUFFLGlCQUFpQixDQUFDLENBQUM7UUFFaEYsSUFBRyxhQUFhLENBQUMsZUFBZSxDQUFDLEVBQUMsQ0FBQztZQUMvQiw0Q0FBNEM7WUFDNUMsSUFBSSxDQUFDLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUUvQyw0RUFBNEU7WUFDNUUsSUFBSSxjQUFjLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztnQkFDdEMsb0ZBQW9GO2dCQUNwRixvRUFBb0U7Z0JBQ3BFLElBQUksV0FBVyxDQUFDLFFBQVEsS0FBSyxTQUFTLEVBQUUsQ0FBQztvQkFDckMsTUFBTSxJQUFJLEtBQUssQ0FBQyxTQUFTLFNBQVMsNkNBQTZDLENBQUMsQ0FBQztnQkFDckYsQ0FBQztnQkFDRCxJQUFJLENBQUMsSUFBSSxDQUFDLDJCQUEyQixDQUFDLHVCQUF1QixTQUFTLEVBQUUsRUFBRSxXQUFXLENBQUMsUUFBUSxDQUFDLENBQUM7Z0JBQzVGLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksU0FBUyw0Q0FBNEMsV0FBVyxDQUFDLFFBQVEsR0FBRyxDQUFDLENBQUM7WUFDdkcsQ0FBQztpQkFBTSxDQUFDO2dCQUNKLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksU0FBUyx1RUFBdUUsQ0FBQyxDQUFDO1lBQzNHLENBQUM7UUFDTCxDQUFDO1FBRUQsTUFBTSxVQUFVLEdBQUcsYUFBYSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBRWxELE1BQU0saUJBQWlCLEdBQXNCO1lBQ3pDLGdCQUFnQixFQUFFLFNBQVM7WUFDM0Isa0JBQWtCLEVBQUUsQ0FBRSxvQkFBTyxDQUFDLFdBQVcsQ0FBRTtZQUMzQyxJQUFJLEVBQUUsaUJBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDO1lBQy9CLHVCQUF1QixFQUFFLENBQUMseUJBQVksQ0FBQyxNQUFNLENBQUM7U0FDakQsQ0FBQztRQUVGLE1BQU0sS0FBSyxHQUFHLElBQUkseUJBQVksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFNBQVMsR0FBRyxRQUFRLEVBQUU7WUFDakUsR0FBRyxpQkFBaUI7WUFDcEIsR0FBRyxXQUFXLENBQUMsVUFBVTtZQUN6QixHQUFHLFVBQVUsRUFBRSxvREFBb0Q7U0FDdEUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxzQkFBVSxDQUFDLEtBQUssRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO1FBRTFGLHdEQUF3RDtRQUN4RCxJQUFJLFdBQVcsQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUM3QixnQkFBZ0IsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUNoQyxDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBMVJELHdDQTBSQztBQXhQZ0I7SUFEWixJQUFBLHFCQUFXLEdBQUU7K0NBeUJiO0FBa09MOzs7O0dBSUc7QUFDSCxTQUFTLGFBQWEsQ0FBQyxTQUFpQjtJQUNwQyxJQUFJLEtBQUssR0FBYSxFQUFFLENBQUM7SUFDekIsTUFBTSxLQUFLLEdBQUcsSUFBQSxxQkFBVyxFQUFDLFNBQVMsQ0FBQyxDQUFDO0lBRXJDLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7UUFDdkIsTUFBTSxRQUFRLEdBQUcsSUFBQSxnQkFBUSxFQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUMzQyxNQUFNLElBQUksR0FBRyxJQUFBLGtCQUFRLEVBQUMsUUFBUSxDQUFDLENBQUM7UUFFaEMsSUFBSSxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUNyQixLQUFLLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztRQUNsRCxDQUFDO2FBQU0sSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksUUFBUSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ25ELEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDekIsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQztBQUNqQixDQUFDO0FBRUQsU0FBUyxZQUFZLENBQUMsTUFBZ0I7SUFDbEMsT0FBTyxDQUFDLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ2xDLENBQUM7QUFFRCxTQUFTLGFBQWEsQ0FBQyxNQUFnQjtJQUNuQyxPQUFPLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsV0FBVyxDQUFDLENBQUM7QUFDN0MsQ0FBQztBQUVELFNBQVMsY0FBYyxDQUFDLE1BQWdCO0lBQ3BDLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLGdCQUFnQixDQUFDLENBQUM7SUFDcEQsbUNBQW1DO0lBQ25DLE9BQU8sS0FBSyxLQUFLLEtBQUssQ0FBQztBQUMzQixDQUFDO0FBRUQsU0FBUyxZQUFZLENBQUMsTUFBZ0I7SUFDbEMsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxXQUFXLENBQUMsQ0FBQztBQUM1QyxDQUFDO0FBRUQsU0FBUyxvQkFBb0IsQ0FBQyxNQUFnQjtJQUMxQyxPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLGNBQWMsQ0FBQyxDQUFDO0FBQy9DLENBQUM7QUFFRCxTQUFnQixhQUFhLENBQUMsTUFBZ0I7SUFDMUMsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxZQUFZLENBQUMsQ0FBQztBQUM3QyxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsS0FBSyxVQUFVLGlCQUFpQixDQUFDLFNBQWlCLEVBQUUsVUFBa0IsRUFBRSxZQUEwQjtJQUM5RixNQUFNLFlBQVksR0FBaUI7UUFDL0IsR0FBRyxZQUFZO1FBQ2YsT0FBTyxFQUFFLFVBQVU7UUFDbkIsV0FBVyxFQUFFLENBQUMsU0FBUyxDQUFDO0tBQzNCLENBQUM7SUFFRix1QkFBYSxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsU0FBUyxNQUFNLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFFdkUsSUFBSSxDQUFDO1FBQ0QsTUFBTSxJQUFBLGVBQUssRUFBQyxZQUFZLENBQUMsQ0FBQztJQUM5QixDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNiLHVCQUFhLENBQUMsS0FBSyxDQUFDLG9CQUFvQixTQUFTLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM3RCxNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixTQUFTLEtBQUssS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUNsSCxDQUFDO0FBQ0wsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxpQkFBaUIsQ0FBQyxRQUFnQjtJQUN2QyxNQUFNLE9BQU8sR0FBRyxJQUFBLHNCQUFZLEVBQUMsUUFBUSxDQUFDLENBQUM7SUFDdkMsT0FBTyxJQUFBLHdCQUFVLEVBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUM5RCxDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0gsU0FBUyxxQkFBcUIsQ0FBQyxPQUFlO0lBQzFDLE1BQU0sSUFBSSxHQUFHLElBQUEsd0JBQVUsRUFBQyxRQUFRLENBQUMsQ0FBQztJQUNsQyxJQUFJLFNBQVMsR0FBRyxDQUFDLENBQUM7SUFFbEIsTUFBTSxnQkFBZ0IsR0FBRyxDQUFDLFdBQW1CLEVBQUUsRUFBRTtRQUM3QyxJQUFJLENBQUMsSUFBQSxvQkFBVSxFQUFDLFdBQVcsQ0FBQztZQUFFLE9BQU87UUFFckMsTUFBTSxJQUFJLEdBQUcsSUFBQSxtQkFBUyxFQUFDLFdBQVcsQ0FBQyxDQUFDO1FBRXBDLElBQUksSUFBSSxDQUFDLGNBQWMsRUFBRSxFQUFFLENBQUM7WUFDeEIsa0VBQWtFO1lBQ2xFLE9BQU87UUFDWCxDQUFDO1FBRUQsSUFBSSxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUNyQixNQUFNLEtBQUssR0FBRyxJQUFBLHFCQUFXLEVBQUMsV0FBVyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsaUNBQWlDO1lBQzVHLEtBQUksTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7Z0JBQ3RCLG9EQUFvRDtnQkFDcEQsSUFBSSxJQUFJLEtBQUssY0FBYyxJQUFJLElBQUksS0FBSyxNQUFNO29CQUMxQyxJQUFJLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxXQUFXO29CQUN2QyxJQUFJLEtBQUssVUFBVSxJQUFJLElBQUksS0FBSyxXQUFXLEVBQUUsQ0FBQztvQkFDOUMsT0FBTztnQkFDWCxDQUFDO2dCQUNELGdCQUFnQixDQUFDLElBQUEsZ0JBQVEsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQztZQUNsRCxDQUFDO1FBQ0wsQ0FBQzthQUFNLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7WUFDdkIsU0FBUyxFQUFFLENBQUM7WUFDWiwyQ0FBMkM7WUFDM0MsTUFBTSxZQUFZLEdBQUcsSUFBQSxvQkFBWSxFQUFDLE9BQU8sRUFBRSxXQUFXLENBQUMsQ0FBQztZQUN4RCxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO1lBQzFCLHFCQUFxQjtZQUNyQixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUEsc0JBQVksRUFBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1FBQzNDLENBQUM7SUFDTCxDQUFDLENBQUM7SUFFRixzREFBc0Q7SUFDdEQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNyQixnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUUxQiwwREFBMEQ7SUFDMUQsOEVBQThFO0lBQzlFLElBQUksU0FBUyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ2xCLElBQUksQ0FBQyxNQUFNLENBQUMscUJBQXFCLENBQUMsQ0FBQztJQUN2QyxDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQzlCLENBQUM7QUFHRDs7O0dBR0c7QUFDSCxTQUFTLGdCQUFnQixDQUFDLFNBQWlCO0lBQ3ZDLElBQUksQ0FBQztRQUNELElBQUEsZ0JBQU0sRUFBQyxTQUFTLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ3BELHVCQUFhLENBQUMsSUFBSSxDQUFDLHNEQUFzRCxTQUFTLEVBQUUsQ0FBQyxDQUFDO0lBQzFGLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsdUJBQWEsQ0FBQyxLQUFLLENBQUMsbURBQW1ELFNBQVMsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ2hHLENBQUM7QUFDTCxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsS0FBSyxVQUFVLG9DQUFvQyxDQUFDLGNBQXNCLEVBQUUsZ0JBQXFDLEVBQUUsTUFBVztJQUMxSCx1RkFBdUY7SUFDdkYsTUFBTSxZQUFZLEdBQUcsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQy9DLE9BQU8sR0FBRyxLQUFLLFFBQVE7UUFDdkIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxJQUFTLDZCQUE2QjtRQUNqRSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLElBQVUsNkJBQTZCO1FBQ2pFLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUMsSUFBTSxrQkFBa0I7UUFDdEQsR0FBRyxLQUFLLFNBQVMsSUFBbUIsa0JBQWtCO1FBQ3RELEdBQUcsS0FBSyxrQkFBa0IsQ0FBVSxnREFBZ0Q7S0FDM0UsQ0FBQztJQUVkLElBQUksWUFBWSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUM1QixPQUFPO0lBQ1gsQ0FBQztJQUVELE1BQU0sU0FBUyxHQUFHLElBQUEsZ0JBQVEsRUFBQyxjQUFjLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDckQsTUFBTSxjQUFjLEdBQUcsSUFBQSxnQkFBUSxFQUFDLFNBQVMsRUFBRSxjQUFjLENBQUMsQ0FBQztJQUMzRCxNQUFNLGVBQWUsR0FBRyxJQUFBLGdCQUFRLEVBQUMsU0FBUyxFQUFFLGNBQWMsQ0FBQyxDQUFDO0lBQzVELE1BQU0sZUFBZSxHQUFHLElBQUEsZ0JBQVEsRUFBQyxTQUFTLEVBQUUsZUFBZSxDQUFDLENBQUM7SUFFN0QsNkJBQTZCO0lBQzdCLE1BQU0sV0FBVyxHQUFRO1FBQ3JCLElBQUksRUFBRSxvQkFBb0I7UUFDMUIsT0FBTyxFQUFFLE9BQU87UUFDaEIsWUFBWSxFQUFFLEVBQUU7S0FDbkIsQ0FBQztJQUVGLHlEQUF5RDtJQUN6RCxNQUFNLFdBQVcsR0FBRyxJQUFBLG1CQUFXLEVBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDL0MsTUFBTSxzQkFBc0IsR0FBRyxJQUFBLGdCQUFRLEVBQUMsV0FBVyxFQUFFLGNBQWMsQ0FBQyxDQUFDO0lBRXJFLDBEQUEwRDtJQUMxRCxNQUFNLGtCQUFrQixHQUEyQixFQUFFLENBQUM7SUFFdEQsSUFBSSxDQUFDLElBQUEsb0JBQVUsRUFBQyxzQkFBc0IsQ0FBQyxFQUFFLENBQUM7UUFDdEMsTUFBTSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsc0JBQXNCLDhCQUE4QixDQUFDLENBQUM7UUFDL0YsS0FBSSxNQUFNLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUM1QixXQUFXLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxHQUFHLFFBQVEsQ0FBQztRQUM3QyxDQUFDO0lBQ0wsQ0FBQztTQUFNLENBQUM7UUFDSixNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBQSxzQkFBWSxFQUFDLHNCQUFzQixFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUM7UUFDckYsNEZBQTRGO1FBQzVGLE1BQU0sV0FBVyxHQUFHLGtCQUFrQixDQUFDLFlBQVksSUFBSSxFQUFFLENBQUM7UUFFMUQsS0FBSSxNQUFNLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUM1QixJQUFJLFdBQVcsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUNuQixJQUFJLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBRWhDLG1HQUFtRztnQkFDbkcsTUFBTSxVQUFVLEdBQUcsUUFBUSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUM7b0JBQzNCLFFBQVEsQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDO29CQUMxQixRQUFRLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQztvQkFDekIsUUFBUSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUM7b0JBQzNCLFFBQVEsQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBRS9DLElBQUksVUFBVSxFQUFFLENBQUM7b0JBQ2IsTUFBTSxTQUFTLEdBQUcsUUFBUSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUM7b0JBQ2hELDZDQUE2QztvQkFDN0MsTUFBTSxZQUFZLEdBQUcsSUFBQSxtQkFBVyxFQUFDLFdBQVcsRUFBRSxTQUFTLENBQUMsQ0FBQztvQkFFekQsZ0NBQWdDO29CQUNoQyxJQUFJLENBQUMsSUFBQSxvQkFBVSxFQUFDLFlBQVksQ0FBQyxFQUFFLENBQUM7d0JBQzVCLE1BQU0sUUFBUSxHQUFHOzRCQUNiLG9CQUFvQixHQUFHLDBCQUEwQixZQUFZLEVBQUU7NEJBQy9ELG9DQUFvQyxRQUFRLEVBQUU7NEJBQzlDLGtDQUFrQyxXQUFXLEVBQUU7NEJBQy9DLHFEQUFxRDt5QkFDeEQsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7d0JBQ2IsTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQzt3QkFDdkIsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQ0FBaUMsR0FBRyxPQUFPLFlBQVksRUFBRSxDQUFDLENBQUM7b0JBQy9FLENBQUM7b0JBRUQsbUVBQW1FO29CQUNuRSxNQUFNLFFBQVEsR0FBRyxJQUFBLGdCQUFRLEVBQUMsWUFBWSxFQUFFLE1BQU0sQ0FBQyxDQUFDO29CQUNoRCxJQUFJLENBQUMsSUFBQSxvQkFBVSxFQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7d0JBQ3hCLE1BQU0sUUFBUSxHQUFHOzRCQUNiLG9CQUFvQixHQUFHLHlCQUF5QixRQUFRLEVBQUU7NEJBQzFELG9FQUFvRTs0QkFDcEUsdUNBQXVDLFlBQVksRUFBRTs0QkFDckQsa0JBQWtCLFlBQVksbUJBQW1CO3lCQUNwRCxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQzt3QkFDYixNQUFNLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDO3dCQUN2QixNQUFNLElBQUksS0FBSyxDQUFDLDRCQUE0QixHQUFHLHdCQUF3QixDQUFDLENBQUM7b0JBQzdFLENBQUM7b0JBRUQscURBQXFEO29CQUNyRCxNQUFNLENBQUMsSUFBSSxDQUFDLCtCQUErQixHQUFHLGtCQUFrQixDQUFDLENBQUM7b0JBQ2xFLE1BQU0sV0FBVyxHQUFHLHFCQUFxQixDQUFDLFFBQVEsQ0FBQyxDQUFDO29CQUVwRCw0REFBNEQ7b0JBQzVELElBQUksV0FBVyxFQUFFLE1BQU0sS0FBSyxFQUFFLEVBQUUsQ0FBQzt3QkFDN0IsTUFBTSxDQUFDLElBQUksQ0FBQywrQkFBK0IsR0FBRyxNQUFNLFdBQVcsRUFBRSxDQUFDLENBQUM7b0JBQ3ZFLENBQUM7b0JBRUQsa0JBQWtCLENBQUMsR0FBRyxDQUFDLEdBQUcsV0FBVyxDQUFDO29CQUN0QyxNQUFNLENBQUMsSUFBSSxDQUFDLHVCQUF1QixHQUFHLFdBQVcsV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLFFBQVEsR0FBRyxHQUFHLENBQUMsQ0FBQztvQkFFN0YsbUVBQW1FO29CQUNuRSxNQUFNLHFCQUFxQixHQUFHLElBQUEsb0JBQVksRUFBQyxTQUFTLEVBQUUsWUFBWSxDQUFDLENBQUM7b0JBQ3BFLFFBQVEsR0FBRyxxQkFBcUIsQ0FBQztvQkFDakMsTUFBTSxDQUFDLElBQUksQ0FBQyxnQ0FBZ0MsR0FBRyxNQUFNLHFCQUFxQixFQUFFLENBQUMsQ0FBQztnQkFDbEYsQ0FBQztnQkFFRCxXQUFXLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxHQUFHLFFBQVEsQ0FBQztZQUM3QyxDQUFDO2lCQUFNLENBQUM7Z0JBQ0osb0VBQW9FO2dCQUNwRSxNQUFNLFFBQVEsR0FBRztvQkFDYixjQUFjLEdBQUcsc0NBQXNDO29CQUN2RCxxR0FBcUc7b0JBQ3JHLFdBQVcsR0FBRyw0REFBNEQ7b0JBQzFFLDJCQUEyQixHQUFHLFNBQVM7b0JBQ3ZDLDRCQUE0QjtpQkFDL0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBRWIsTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQztnQkFDdkIsTUFBTSxJQUFJLEtBQUssQ0FBQywrQkFBK0IsR0FBRyxFQUFFLENBQUMsQ0FBQztZQUMxRCxDQUFDO1FBQ0wsQ0FBQztRQUFBLENBQUM7SUFDTixDQUFDO0lBRUQsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDaEUsTUFBTSxJQUFJLEdBQUcsSUFBQSx3QkFBVSxFQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ2xDLElBQUksQ0FBQyxNQUFNLENBQUMsa0JBQWtCLENBQUMsQ0FBQztJQUVoQyxrRUFBa0U7SUFDbEUsNEVBQTRFO0lBQzVFLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUM3QyxNQUFNLENBQUMsS0FBSyxDQUFDLGtCQUFrQixNQUFNLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUMsTUFBTSw0Q0FBNEMsQ0FBQyxDQUFDO1FBQ25ILEtBQUksTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQ2xGLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxHQUFHLElBQUksa0JBQWtCLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3JELENBQUM7SUFDTCxDQUFDO0lBRUQsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBRTlDLGtFQUFrRTtJQUNsRSw4Q0FBOEM7SUFDOUMsa0VBQWtFO0lBQ2xFLElBQUksVUFBVSxHQUFrQixJQUFJLENBQUM7SUFDckMsSUFBSSxDQUFDLElBQUEsb0JBQVUsRUFBQyxlQUFlLENBQUMsRUFBRSxDQUFDO1FBQy9CLFVBQVUsR0FBRywyQ0FBMkMsQ0FBQztJQUM3RCxDQUFDO1NBQU0sSUFBSSxDQUFDLElBQUEsb0JBQVUsRUFBQyxjQUFjLENBQUMsRUFBRSxDQUFDO1FBQ3JDLFVBQVUsR0FBRyxrQ0FBa0MsQ0FBQztJQUNwRCxDQUFDO1NBQU0sQ0FBQztRQUNKLElBQUksQ0FBQztZQUNELE1BQU0sWUFBWSxHQUFHLElBQUEsc0JBQVksRUFBQyxlQUFlLEVBQUUsT0FBTyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDbkUsZ0RBQWdEO1lBQ2hELElBQUksWUFBWSxDQUFDLE1BQU0sS0FBSyxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztnQkFDckUsVUFBVSxHQUFHLDBDQUEwQyxZQUFZLENBQUMsTUFBTSxTQUFTLENBQUM7WUFDeEYsQ0FBQztpQkFBTSxJQUFJLFlBQVksS0FBSyxrQkFBa0IsRUFBRSxDQUFDO2dCQUM3QyxNQUFNLENBQUMsSUFBSSxDQUFDLGdFQUFnRSxDQUFDLENBQUM7Z0JBQzlFLE9BQU8sQ0FBQyxxQkFBcUI7WUFDakMsQ0FBQztpQkFBTSxDQUFDO2dCQUNKLFVBQVUsR0FBRyw2QkFBNkIsQ0FBQztnQkFDM0MsTUFBTSxDQUFDLElBQUksQ0FBQyx1QkFBdUIsWUFBWSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUN2RSxNQUFNLENBQUMsSUFBSSxDQUFDLHVCQUF1QixrQkFBa0IsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDN0UsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO29CQUM3QyxNQUFNLENBQUMsSUFBSSxDQUFDLHlDQUF5QyxNQUFNLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDdkcsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO1FBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztZQUNsQixVQUFVLEdBQUcsNkJBQTZCLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUM5RCxDQUFDO0lBQ0wsQ0FBQztJQUVELGtFQUFrRTtJQUNsRSxxQ0FBcUM7SUFDckMsa0VBQWtFO0lBQ2xFLE1BQU0sQ0FBQyxJQUFJLENBQUMsc0NBQXNDLFVBQVUsR0FBRyxDQUFDLENBQUM7SUFDakUsTUFBTSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsWUFBWSxDQUFDLE1BQU0sZ0JBQWdCLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBRTdGLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBRXBDLDBCQUEwQjtJQUMxQixJQUFJLENBQUMsSUFBQSxvQkFBVSxFQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7UUFDekIsSUFBQSxtQkFBUyxFQUFDLFNBQVMsRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0lBQzlDLENBQUM7SUFFRCxxQkFBcUI7SUFDckIsSUFBQSx1QkFBYSxFQUFDLGVBQWUsRUFBRSxrQkFBa0IsQ0FBQyxDQUFDO0lBRW5ELHVCQUF1QjtJQUN2QixJQUFJLENBQUM7UUFDRCw0RUFBNEU7UUFDNUUsMERBQTBEO1FBQzFELG1FQUFtRTtRQUNuRSw0REFBNEQ7UUFDNUQsSUFBQSw2QkFBUSxFQUFDLDJFQUEyRSxFQUFFO1lBQ2xGLEdBQUcsRUFBRSxTQUFTO1lBQ2QsS0FBSyxFQUFFLFNBQVM7U0FDbkIsQ0FBQyxDQUFDO1FBRUgsTUFBTSxPQUFPLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxnQkFBZ0IsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNwRSxNQUFNLENBQUMsSUFBSSxDQUFDLGdDQUFnQyxPQUFPLEdBQUcsQ0FBQyxDQUFDO1FBRXhELHlCQUF5QjtRQUN6QixJQUFBLHVCQUFhLEVBQUMsZUFBZSxFQUFFLGtCQUFrQixDQUFDLENBQUM7SUFFdkQsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDYixNQUFNLENBQUMsS0FBSyxDQUFDLDBDQUEwQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ2hFLE1BQU0sS0FBSyxDQUFDO0lBQ2hCLENBQUM7QUFDTCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLGFBQWEsQ0FBQyxNQUFjLEVBQUUsTUFBYztJQUNqRCxJQUFJLENBQUMsSUFBQSxvQkFBVSxFQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7UUFDdEIsSUFBQSxtQkFBUyxFQUFDLE1BQU0sRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0lBQzNDLENBQUM7SUFDRCxNQUFNLEtBQUssR0FBRyxJQUFBLHFCQUFXLEVBQUMsTUFBTSxDQUFDLENBQUM7SUFDbEMsS0FBSSxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUUsQ0FBQztRQUN0QixNQUFNLFVBQVUsR0FBRyxJQUFBLGdCQUFRLEVBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzFDLE1BQU0sVUFBVSxHQUFHLElBQUEsZ0JBQVEsRUFBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDMUMsSUFBSSxJQUFBLG1CQUFTLEVBQUMsVUFBVSxDQUFDLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUN0QyxhQUFhLENBQUMsVUFBVSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQzFDLENBQUM7YUFBTSxDQUFDO1lBQ0osSUFBQSxzQkFBWSxFQUFDLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUN6QyxDQUFDO0lBQ0wsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuXG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0LCBGVzI0Q29uc3RydWN0T3V0cHV0LCBPdXRwdXRUeXBlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBEZWZhdWx0TG9nZ2VyLCBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyLCBJTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IFRpbWVyIH0gZnJvbSBcIi4uL3V0aWxzL3RpbWVyXCI7XG5pbXBvcnQgeyBBcmNoaXRlY3R1cmUsIENvZGUsIExheWVyVmVyc2lvbiwgTGF5ZXJWZXJzaW9uUHJvcHMsIFJ1bnRpbWUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IGJhc2VuYW1lIGFzIHBhdGhCYXNlTmFtZSwgcmVzb2x2ZSBhcyBwYXRoUmVzb2x2ZSwgam9pbiBhcyBwYXRoSm9pbiwgZXh0bmFtZSBhcyBwYXRoRXh0bmFtZSwgcmVsYXRpdmUgYXMgcGF0aFJlbGF0aXZlIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGV4aXN0c1N5bmMsIG1rZGlyU3luYywgcmVhZGRpclN5bmMsIHN0YXRTeW5jLCBybVN5bmMsIGxzdGF0U3luYywgY29weUZpbGVTeW5jLCByZWFkRmlsZVN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tICdub2RlOmZzJztcbmltcG9ydCB7IGV4ZWNTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGJ1aWxkLCBCdWlsZE9wdGlvbnMgfSBmcm9tICdlc2J1aWxkJztcbmltcG9ydCB7IExheWVyRW50cnkgfSBmcm9tIFwiLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwibm9kZTpjcnlwdG9cIjtcbmltcG9ydCB7IG1lcmdlIH0gZnJvbSBcIi4uL3V0aWxzL21lcmdlXCI7XG5cblxuLyoqXG4gKiBDb21tb24gbGF5ZXIgY29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzXG4gKi9cbmludGVyZmFjZSBJQmFzZUxheWVyQ29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIHNvdXJjZSBwYXRoIG9mIHRoZSBsYXllciBkaXJlY3Rvcnkgb3IgZmlsZS5cbiAgICAgKi9cbiAgICBzb3VyY2VQYXRoOiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBwcm9wZXJ0aWVzIGZvciB0aGUgbGF5ZXIgdmVyc2lvbi5cbiAgICAgKi9cbiAgICBsYXllclByb3BzPzogT21pdDxMYXllclZlcnNpb25Qcm9wcywgJ2NvZGUnPjtcblxuICAgIC8qKlxuICAgICAqIEN1c3RvbSBidWlsZCBvcHRpb25zIGZvciBlc2J1aWxkIGJ1bmRsaW5nLlxuICAgICAqIE1lcmdlZCBpbiBwcmlvcml0eSBvcmRlcjogZGVmYXVsdHMgPCBjb25zdHJ1Y3QtbGV2ZWwgPCBkZWNvcmF0b3ItbGV2ZWxcbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHtcbiAgICAgKiAgIGJ1aWxkT3B0aW9uczoge1xuICAgICAqICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICogICAgIG1pbmlmeTogZmFsc2UsXG4gICAgICogICAgIGV4dGVybmFsOiBbJ0Bhd3Mtc2RrJywgJ3NvbWUtbmF0aXZlLW1vZHVsZSddXG4gICAgICogICB9XG4gICAgICogfVxuICAgICAqL1xuICAgIGJ1aWxkT3B0aW9ucz86IEJ1aWxkT3B0aW9ucztcblxuICAgIC8qKlxuICAgICAqIFdoZXRoZXIgdGhpcyBsYXllciBzaG91bGQgTk9UIGJlIGFkZGVkIGFzIGEgZ2xvYmFsIGxheWVyLlxuICAgICAqIElmIGZhbHNlIG9yIHVuZGVmaW5lZCwgdGhlIGxheWVyIHdpbGwgYmUgYXV0b21hdGljYWxseSBhdHRhY2hlZCB0byBhbGwgTGFtYmRhIGZ1bmN0aW9ucy5cbiAgICAgKiBEZWZhdWx0cyB0byBmYWxzZSAobGF5ZXIgSVMgZ2xvYmFsKS5cbiAgICAgKi9cbiAgICBub3RHbG9iYWw/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogV2hldGhlciB0aGlzIGxheWVyIHNob3VsZCBiZSBsb2FkZWQgYXMgYW4gZW50cnkgcGFja2FnZSAoY29kZSBleGVjdXRlcyBhdCBtb2R1bGUgaW5pdGlhbGl6YXRpb24pLlxuICAgICAqIElmIGZhbHNlLCB0aGUgbGF5ZXIgaXMgb25seSBhdmFpbGFibGUgZm9yIGltcG9ydHMgYnV0IGRvZXNuJ3QgZXhlY3V0ZS5cbiAgICAgKiBEZWZhdWx0cyB0byBmYWxzZS5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIC8vIGZ3MjQgcnVudGltZSBsYXllciAtIGF2YWlsYWJsZSBmb3IgaW1wb3J0IGJ1dCBkb2Vzbid0IGV4ZWN1dGVcbiAgICAgKiB7IHNvdXJjZVBhdGg6ICcuL2Z3MjQuanMnLCBpc0VudHJ5UGFja2FnZTogZmFsc2UgfVxuICAgICAqIFxuICAgICAqIC8vIGRpIGxheWVyIC0gZXhlY3V0ZXMgRElDb250YWluZXIuUk9PVC5tb2R1bGUoKSBhdCBpbml0XG4gICAgICogeyBzb3VyY2VQYXRoOiAnLi9kaS50cycsIGlzRW50cnlQYWNrYWdlOiB0cnVlIH1cbiAgICAgKi9cbiAgICBpc0VudHJ5UGFja2FnZT86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBQcmlvcml0eSBmb3IgbGF5ZXIgbG9hZGluZyBvcmRlci4gTG93ZXIgbnVtYmVycyBsb2FkIGZpcnN0LlxuICAgICAqIElmIG5vdCBzcGVjaWZpZWQsIHByaW9yaXR5IGlzIGF1dG8tYXNzaWduZWQgYXMgKGFycmF5X2luZGV4ICsgMTApLlxuICAgICAqIFxuICAgICAqIFByaW9yaXR5IHJhbmdlczpcbiAgICAgKiAtIDAtOTogUmVzZXJ2ZWQgZm9yIGZyYW1ld29yayBsYXllcnMgKGZ3MjQgY29yZSA9IDApXG4gICAgICogLSAxMCs6IFVzZXIvYXBwbGljYXRpb24gbGF5ZXJzIChhdXRvLWFzc2lnbmVkIG9yIGV4cGxpY2l0KVxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogLy8gQXV0by1hc3NpZ25lZCBwcmlvcml0aWVzIChyZWNvbW1lbmRlZCk6XG4gICAgICogY29uc3QgbGF5ZXJzID0gbmV3IExheWVyQ29uc3RydWN0KFtcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vZGkudHMnIH0sICAgICAgICAvLyBwcmlvcml0eTogMTBcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vc2hhcmVkLnRzJyB9LCAgICAvLyBwcmlvcml0eTogMTFcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vZmlyZWJhc2UudHMnIH0gICAvLyBwcmlvcml0eTogMTJcbiAgICAgKiBdKTtcbiAgICAgKiBcbiAgICAgKiAvLyBFeHBsaWNpdCBwcmlvcml0aWVzIChmb3Igc3BlY2lhbCBjYXNlcyk6XG4gICAgICogY29uc3QgbGF5ZXJzID0gbmV3IExheWVyQ29uc3RydWN0KFtcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vZGkudHMnLCBwcmlvcml0eTogMTAgfSwgICAgICAvLyBMb2FkIGZpcnN0XG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2ZpcmViYXNlLnRzJywgcHJpb3JpdHk6IDIwIH0sIC8vIExvYWQgbGFzdFxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9zaGFyZWQudHMnLCBwcmlvcml0eTogMTUgfSAgIC8vIExvYWQgaW4gYmV0d2VlblxuICAgICAqIF0pO1xuICAgICAqL1xuICAgIHByaW9yaXR5PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIHRoZSBQQUNLQUdFX0RJUkVDVE9SWSBtb2RlLlxuICogUGFja2FnZXMgYSBwcmUtYnVpbHQgZGlyZWN0b3J5IGFzLWlzIHdpdGhvdXQgYnVuZGxpbmcuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVBhY2thZ2VEaXJlY3RvcnlDb25maWcgZXh0ZW5kcyBJQmFzZUxheWVyQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgbmFtZSBvZiB0aGUgbGF5ZXIuXG4gICAgICovXG4gICAgbGF5ZXJOYW1lOiBzdHJpbmc7XG4gICAgXG4gICAgLyoqXG4gICAgICogVGhlIG1vZGUgb2YgcGFja2FnaW5nOiBwYWNrYWdlIHRoZSB3aG9sZSBkaXJlY3RvcnkuXG4gICAgICovXG4gICAgbW9kZT86ICdQQUNLQUdFX0RJUkVDVE9SWSc7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIEJVSUxEX0FORF9QQUNLQUdFIG1vZGUuXG4gKiBCdW5kbGVzIHNvdXJjZSBmaWxlcyB3aXRoIGVzYnVpbGQgYmVmb3JlIHBhY2thZ2luZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnIGV4dGVuZHMgSUJhc2VMYXllckNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIG1vZGUgb2YgcGFja2FnaW5nOiBzY2FuIGFuZCBidWlsZCBpbmRpdmlkdWFsIGZpbGVzLlxuICAgICAqL1xuICAgIG1vZGU6ICdCVUlMRF9BTkRfUEFDS0FHRSc7XG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBjdXN0b20gZGlzdHJpYnV0aW9uIGRpcmVjdG9yeSBmb3IgdGhlIGJ1aWxkIG91dHB1dHMuXG4gICAgICovXG4gICAgZGlzdERpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIEZsYWcgdG8gY2xlYXIgdGhlIG91dHB1dCBkaXJlY3RvcnkgYWZ0ZXIgcGFja2FnaW5nOyBkZWZhdWx0cyB0byBmYWxzZS5cbiAgICAgKi9cbiAgICBjbGVhck91dHB1dERpcj86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBDb25maWd1cmFibGUgb3V0cHV0IHBhdGggZm9yIHRoZSBwYWNrYWdlLlxuICAgICAqLyBcbiAgICBwYWNrYWdlUGF0aD86IHN0cmluZztcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBsYXllciBjb25zdHJ1Y3QuXG4gKiBcbiAqIExheWVycyBhcmUgcHJvY2Vzc2VkIGluIHBhcmFsbGVsIGZvciBzcGVlZCwgYnV0IGxvYWRlZCBhdCBydW50aW1lIGluIHByaW9yaXR5IG9yZGVyLlxuICogUHJpb3JpdHkgZGV0ZXJtaW5lcyB0aGUgb3JkZXIgaW4gd2hpY2ggbGF5ZXJzIGluaXRpYWxpemUgd2hlbiBMYW1iZGEgY29sZCBzdGFydHMuXG4gKiBcbiAqIEBzZWUgSUJ1aWxkQW5kUGFja2FnZUNvbmZpZy5wcmlvcml0eSBmb3IgcHJpb3JpdHkgZGV0YWlsc1xuICovXG5leHBvcnQgdHlwZSBJTGF5ZXJDb25zdHJ1Y3RDb25maWcgPSBJUGFja2FnZURpcmVjdG9yeUNvbmZpZyB8IElCdWlsZEFuZFBhY2thZ2VDb25maWc7XG5cbi8qKlxuICogUmVwcmVzZW50cyBhIGNvbnN0cnVjdCBmb3IgY3JlYXRpbmcgTGFtYmRhIGxheWVycy5cbiAqIFxuICogTGF5ZXJzIGFyZSBidWlsdCBpbiBwYXJhbGxlbCBmb3IgcGVyZm9ybWFuY2UsIGJ1dCBpbml0aWFsaXplIGF0IExhbWJkYSBydW50aW1lXG4gKiBpbiBwcmlvcml0eSBvcmRlci4gVGhpcyBlbnN1cmVzIGNvcnJlY3QgZGVwZW5kZW5jeSBsb2FkaW5nIChlLmcuLCBESSBjb250YWluZXJcbiAqIGxvYWRzIGJlZm9yZSBsYXllcnMgdGhhdCB1c2UgaXQpLlxuICogXG4gKiBQcmlvcml0eSBTeXN0ZW06XG4gKiAtIDAtOTogUmVzZXJ2ZWQgZm9yIGZyYW1ld29yayBsYXllcnMgKGZ3MjQgY29yZSA9IDApXG4gKiAtIDEwKzogQXBwbGljYXRpb24gbGF5ZXJzIChhdXRvLWFzc2lnbmVkIHN0YXJ0aW5nIGF0IDEwLCBvciBzZXQgZXhwbGljaXRseSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiAvLyBCYXNpYyB1c2FnZSB3aXRoIGF1dG8tcHJpb3JpdHkgKHJlY29tbWVuZGVkKVxuICogY29uc3QgZGlMYXllciA9IG5ldyBESUxheWVyQ29uc3RydWN0KFtcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvZGkudHMnIH0sICAgICAgICAgICAgICAvLyBwcmlvcml0eTogMTAgKGF1dG8pXG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2NvbmZpZy9zaGFyZWQudHMnIH0sICAgLy8gcHJpb3JpdHk6IDExIChhdXRvKVxuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9jb25maWcvZmlyZWJhc2UudHMnIH0gIC8vIHByaW9yaXR5OiAxMiAoYXV0bylcbiAqIF0pO1xuICogXG4gKiAvLyBBZHZhbmNlZCB1c2FnZSB3aXRoIGV4cGxpY2l0IHByaW9yaXRpZXNcbiAqIGNvbnN0IGRpTGF5ZXIgPSBuZXcgRElMYXllckNvbnN0cnVjdChbXG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2RpLnRzJywgcHJpb3JpdHk6IDEwIH0sICAgICAgICAvLyBMb2FkIGZpcnN0XG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2NvbmZpZy9maXJlYmFzZS50cycsIHByaW9yaXR5OiAyMCB9LCAvLyBMb2FkIGxhc3RcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvY29uZmlnL3NoYXJlZC50cycsIHByaW9yaXR5OiAxNSB9ICAgIC8vIExvYWQgaW4gYmV0d2VlblxuICogXSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIExheWVyQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyOiBJTG9nZ2VyO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgXG4gICAgbmFtZSA9IExheWVyQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgTGF5ZXJDb25zdHJ1Y3QgaW5zdGFuY2UuXG4gICAgICogQHBhcmFtIGNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgTGF5ZXJDb25zdHJ1Y3QuXG4gICAgICovXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBjb25maWc6IElMYXllckNvbnN0cnVjdENvbmZpZ1tdLCB2ZXJib3NlTG9nID86IG51bWJlcikge1xuXG4gICAgICAgIGlmKHZlcmJvc2VMb2cpe1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIgPSBjcmVhdGVMb2dnZXIoTGF5ZXJDb25zdHJ1Y3QubmFtZSwgMSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihMYXllckNvbnN0cnVjdC5uYW1lKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gYWRkIGRlZmF1bHRzXG4gICAgICAgIGZvcihjb25zdCBsYXllckNvbmZpZyBvZiBjb25maWcpIHtcbiAgICAgICAgICAgIGxheWVyQ29uZmlnLm1vZGUgPSBsYXllckNvbmZpZy5tb2RlIHx8ICdQQUNLQUdFX0RJUkVDVE9SWSc7XG4gICAgICAgICAgICBpZiAobGF5ZXJDb25maWcubW9kZSA9PT0gJ0JVSUxEX0FORF9QQUNLQUdFJykge1xuICAgICAgICAgICAgICAgIGxheWVyQ29uZmlnLmNsZWFyT3V0cHV0RGlyID0gbGF5ZXJDb25maWcuY2xlYXJPdXRwdXREaXIgPz8gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhjb25maWcsICdMQVlFUicpO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgLy8gQXNzaWduIHByaW9yaXR5IHRvIGVhY2ggbGF5ZXI6IHVzZSBleHBsaWNpdCBwcmlvcml0eSBpZiBzZXQsIG90aGVyd2lzZSB1c2UgYXJyYXkgaW5kZXggKyAxMFxuICAgICAgICAvLyBQcmlvcml0eSAwLTkgcmVzZXJ2ZWQgZm9yIGZyYW1ld29yayBsYXllcnMgKGZ3MjQgY29yZSA9IDApXG4gICAgICAgIC8vIFVzZXIgbGF5ZXJzIHN0YXJ0IGF0IDEwKyB0byBlbnN1cmUgZnJhbWV3b3JrIGxheWVycyBhbHdheXMgbG9hZCBmaXJzdFxuICAgICAgICBmb3IoY29uc3QgW2luZGV4LCBsYXllckNvbmZpZ10gb2YgdGhpcy5jb25maWcuZW50cmllcygpKSB7XG4gICAgICAgICAgICBpZiAoIWxheWVyQ29uZmlnLnByaW9yaXR5ICYmIGxheWVyQ29uZmlnLnByaW9yaXR5ICE9PSAwKSB7XG4gICAgICAgICAgICAgICAgbGF5ZXJDb25maWcucHJpb3JpdHkgPSBpbmRleCArIDEwO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gUHJvY2VzcyBsYXllcnMgaW4gcGFyYWxsZWwgZm9yIHNwZWVkIHdoaWxlIHJlc3BlY3RpbmcgcHJpb3JpdHktYmFzZWQgbG9hZGluZyBvcmRlclxuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbCh0aGlzLmNvbmZpZy5tYXAoYXN5bmMgKGxheWVyQ29uZmlnKSA9PiB7XG4gICAgICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayhsYXllckNvbmZpZy5zdGFja05hbWUgfHwgdGhpcy5mdzI0LmdldENvbmZpZygpLmxheWVyU3RhY2tOYW1lLCBsYXllckNvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlByb2Nlc3NpbmcgbGF5ZXI6XCIsIGxheWVyQ29uZmlnKTtcblxuICAgICAgICAgICAgaWYgKGxheWVyQ29uZmlnLm1vZGUgPT09ICdQQUNLQUdFX0RJUkVDVE9SWScpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBhY2thZ2VEaXJlY3RvcnkobGF5ZXJDb25maWcpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllckNvbmZpZy5tb2RlID09PSAnQlVJTERfQU5EX1BBQ0tBR0UnKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zY2FuQW5kUGFja2FnZUZpbGVzKGxheWVyQ29uZmlnKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIG1vZGUgZm9yIGxheWVyICR7SlNPTi5zdHJpbmdpZnkobGF5ZXJDb25maWcpfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGFja2FnZXMgYSBkaXJlY3RvcnkgYXMgYSBMYW1iZGEgbGF5ZXIuXG4gICAgICogQHBhcmFtIGxheWVyQ29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBsYXllci5cbiAgICAgKiBAcGFyYW0gbWFpblN0YWNrIC0gVGhlIG1haW4gc3RhY2sgZm9yIGRlcGxveWluZyByZXNvdXJjZXMuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBwYWNrYWdlRGlyZWN0b3J5KGxheWVyQ29uZmlnOiBJUGFja2FnZURpcmVjdG9yeUNvbmZpZykge1xuICAgICAgICBjb25zdCBkZWZhdWx0TGF5ZXJQcm9wczogTGF5ZXJWZXJzaW9uUHJvcHMgPSB7XG4gICAgICAgICAgICBsYXllclZlcnNpb25OYW1lOiBsYXllckNvbmZpZy5sYXllck5hbWUsXG4gICAgICAgICAgICBjb21wYXRpYmxlUnVudGltZXM6IFsgUnVudGltZS5OT0RFSlNfMjJfWCBdLFxuICAgICAgICAgICAgY29kZTogQ29kZS5mcm9tQXNzZXQobGF5ZXJDb25maWcuc291cmNlUGF0aCksXG4gICAgICAgICAgICBjb21wYXRpYmxlQXJjaGl0ZWN0dXJlczogW0FyY2hpdGVjdHVyZS5BUk1fNjRdLFxuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgY29uc3QgbGF5ZXIgPSBuZXcgTGF5ZXJWZXJzaW9uKHRoaXMubWFpblN0YWNrLCBsYXllckNvbmZpZy5sYXllck5hbWUgKyAnLWxheWVyJywge1xuICAgICAgICAgICAgLi4uZGVmYXVsdExheWVyUHJvcHMsXG4gICAgICAgICAgICAuLi5sYXllckNvbmZpZy5sYXllclByb3BzLFxuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgbGF5ZXJDb25maWcubGF5ZXJOYW1lLCBsYXllciwgT3V0cHV0VHlwZS5MQVlFUiwgJ2xheWVyVmVyc2lvbkFybicpO1xuXG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBTY2FucyBhIGRpcmVjdG9yeSBmb3IgVHlwZVNjcmlwdCBmaWxlcyBhbmQgY3JlYXRlcyBMYW1iZGEgbGF5ZXJzIGZvciB0aGVtLlxuICAgICAqIEBwYXJhbSBsYXllckNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgbGF5ZXIuXG4gICAgICogQHBhcmFtIG1haW5TdGFjayAtIFRoZSBtYWluIHN0YWNrIGZvciBkZXBsb3lpbmcgcmVzb3VyY2VzLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgc2NhbkFuZFBhY2thZ2VGaWxlcyhsYXllckNvbmZpZzogSUJ1aWxkQW5kUGFja2FnZUNvbmZpZykge1xuICAgICAgICAvLyBEZWZhdWx0IHRvIGFwcGxpY2F0aW9uJ3MgZGlzdC9sYXllcnMgZGlyZWN0b3J5IChwcm9jZXNzLmN3ZCgpIGlzIHRoZSBhcHBsaWNhdGlvbiByb290KVxuICAgICAgICBjb25zdCBkaXN0RGlyZWN0b3J5ID0gbGF5ZXJDb25maWcuZGlzdERpcmVjdG9yeSB8fCBwYXRoSm9pbihwcm9jZXNzLmN3ZCgpLCAnZGlzdC9sYXllcnMnKTtcbiAgICAgICAgY29uc3Qgc291cmNlRGlyZWN0b3J5T3JGaWxlTmFtZSA9IHBhdGhSZXNvbHZlKGxheWVyQ29uZmlnLnNvdXJjZVBhdGgpO1xuICAgICAgICBjb25zdCB0c0ZpbGVzID0gbHN0YXRTeW5jKHNvdXJjZURpcmVjdG9yeU9yRmlsZU5hbWUpLmlzRGlyZWN0b3J5KClcbiAgICAgICAgICAgID8gc2NhbkRpcmVjdG9yeShzb3VyY2VEaXJlY3RvcnlPckZpbGVOYW1lKVxuICAgICAgICAgICAgOiBbc291cmNlRGlyZWN0b3J5T3JGaWxlTmFtZV07XG5cbiAgICAgICAgLy8gUHJvY2VzcyBmaWxlcyBpbiBwYXJhbGxlbCBub3cgdGhhdCB3ZSBoYXZlIHByaW9yaXR5LWJhc2VkIG9yZGVyaW5nXG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHRzRmlsZXMubWFwKGFzeW5jIChmaWxlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnRyeUNyZWF0ZUxheWVyRm9yRmlsZShmaWxlLCBkaXN0RGlyZWN0b3J5LCBsYXllckNvbmZpZyk7XG4gICAgICAgIH0pKTtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIE1lcmdlcyBidWlsZCBvcHRpb25zIHdpdGggcHJvcGVyIHByaW9yaXR5OiBkZWZhdWx0cyA8IGNvbnN0cnVjdC1sZXZlbCA8IGRlY29yYXRvci1sZXZlbFxuICAgICAqIEBwYXJhbSBsYXllck5hbWUgLSBMYXllciBuYW1lIGZvciBsb2dnaW5nXG4gICAgICogQHBhcmFtIGNvbnN0cnVjdEJ1aWxkT3B0aW9ucyAtIEJ1aWxkIG9wdGlvbnMgZnJvbSBjb25zdHJ1Y3QgY29uZmlnXG4gICAgICogQHBhcmFtIGRlY29yYXRvckJ1aWxkT3B0aW9ucyAtIEJ1aWxkIG9wdGlvbnMgZnJvbSBATGF5ZXJFbnRyeSBkZWNvcmF0b3JcbiAgICAgKiBAcmV0dXJucyBNZXJnZWQgYnVpbGQgb3B0aW9uc1xuICAgICAqL1xuICAgIHByaXZhdGUgbWVyZ2VCdWlsZE9wdGlvbnMoXG4gICAgICAgIGxheWVyTmFtZTogc3RyaW5nLFxuICAgICAgICBjb25zdHJ1Y3RCdWlsZE9wdGlvbnM/OiBCdWlsZE9wdGlvbnMsXG4gICAgICAgIGRlY29yYXRvckJ1aWxkT3B0aW9ucz86IEJ1aWxkT3B0aW9uc1xuICAgICk6IEJ1aWxkT3B0aW9ucyB7XG4gICAgICAgIC8vIERlZmF1bHQgYnVpbGQgb3B0aW9ucyBmb3IgYWxsIGxheWVyc1xuICAgICAgICBjb25zdCBkZWZhdWx0QnVpbGRPcHRpb25zOiBCdWlsZE9wdGlvbnMgPSB7XG4gICAgICAgICAgICBidW5kbGU6IHRydWUsXG4gICAgICAgICAgICBwbGF0Zm9ybTogJ25vZGUnLFxuICAgICAgICAgICAgdGFyZ2V0OiAnbm9kZTE4JyxcbiAgICAgICAgICAgIG1pbmlmeTogZmFsc2UsXG4gICAgICAgICAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgICAgICAgICAgZXh0ZXJuYWw6IFtcbiAgICAgICAgICAgICAgICAvLyBGcmFtZXdvcmsgcnVudGltZSBwcm92aWRlZCBieSBzZXBhcmF0ZSBmdzI0IGxheWVyXG4gICAgICAgICAgICAgICAgJ0B0ZW4yNGdyb3VwL2Z3MjQnLFxuICAgICAgICAgICAgICAgIC8vIEFXUyBTREsgYW5kIGJ1aWxkIHRvb2xzXG4gICAgICAgICAgICAgICAgJ0Bhd3Mtc2RrJyxcbiAgICAgICAgICAgICAgICAnQHNtaXRoeScsXG4gICAgICAgICAgICAgICAgJ2F3cy1jZGstbGliJyxcbiAgICAgICAgICAgICAgICAnZXNidWlsZCcsXG4gICAgICAgICAgICBdXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gTWVyZ2UgaW4gcHJpb3JpdHkgb3JkZXIgdXNpbmcgZGVlcCBtZXJnZVxuICAgICAgICBjb25zdCBtZXJnZWQgPSAobWVyZ2UoW1xuICAgICAgICAgICAgZGVmYXVsdEJ1aWxkT3B0aW9ucyxcbiAgICAgICAgICAgIGNvbnN0cnVjdEJ1aWxkT3B0aW9ucyB8fCB7fSxcbiAgICAgICAgICAgIGRlY29yYXRvckJ1aWxkT3B0aW9ucyB8fCB7fVxuICAgICAgICBdKSA/PyBkZWZhdWx0QnVpbGRPcHRpb25zKTtcblxuICAgICAgICAvLyBMb2cgbWVyZ2VkIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFske2xheWVyTmFtZX1dIEJ1aWxkIG9wdGlvbnMgbWVyZ2VkOmAsIHtcbiAgICAgICAgICAgIHNvdXJjZW1hcDogbWVyZ2VkLnNvdXJjZW1hcCxcbiAgICAgICAgICAgIG1pbmlmeTogbWVyZ2VkLm1pbmlmeSxcbiAgICAgICAgICAgIGV4dGVybmFsOiBtZXJnZWQuZXh0ZXJuYWwsXG4gICAgICAgICAgICBwbGF0Zm9ybTogbWVyZ2VkLnBsYXRmb3JtLFxuICAgICAgICAgICAgdGFyZ2V0OiBtZXJnZWQudGFyZ2V0XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBtZXJnZWQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQXR0ZW1wdHMgdG8gY3JlYXRlIGEgTGFtYmRhIGxheWVyIGZvciBhIGdpdmVuIFR5cGVTY3JpcHQgZmlsZS5cbiAgICAgKiBAcGFyYW0gZmlsZSAtIFRoZSBwYXRoIHRvIHRoZSBUeXBlU2NyaXB0IGZpbGUuXG4gICAgICogQHBhcmFtIGRpc3REaXJlY3RvcnkgLSBUaGUgb3V0cHV0IGRpcmVjdG9yeSBmb3IgdGhlIGJ1aWxkLlxuICAgICAqIEBwYXJhbSBtYWluU3RhY2sgLSBUaGUgbWFpbiBzdGFjayBmb3IgZGVwbG95aW5nIHJlc291cmNlcy5cbiAgICAgKiBAcGFyYW0gbGF5ZXJDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIGxheWVyLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgdHJ5Q3JlYXRlTGF5ZXJGb3JGaWxlKGZpbGU6IHN0cmluZywgZGlzdERpcmVjdG9yeTogc3RyaW5nLCBsYXllckNvbmZpZzogSUJ1aWxkQW5kUGFja2FnZUNvbmZpZykge1xuICAgICAgICBjb25zdCBmaWxlQmFzZU5hbWUgPSBwYXRoQmFzZU5hbWUoZmlsZSwgcGF0aEV4dG5hbWUoZmlsZSkpO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBQcm9jZXNzaW5nIGxheWVyOiAke2ZpbGVCYXNlTmFtZX1gKTtcbiAgICAgICAgXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBMb2FkaW5nIGxheWVyIGRlc2NyaXB0b3IgZnJvbSAke2ZpbGV9Li4uYCk7XG4gICAgICAgIGNvbnN0IG1vZHVsZUV4cG9ydHMgPSBhd2FpdCBpbXBvcnQoZmlsZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBMYXllciBkZXNjcmlwdG9yIGxvYWRlZGApO1xuXG4gICAgICAgIGNvbnN0IGZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSA9IE9iamVjdC5rZXlzKG1vZHVsZUV4cG9ydHMpLmZpbmQoKGtleSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZXhwb3J0ZWQgPSBtb2R1bGVFeHBvcnRzW2tleV07XG4gICAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydGVkID09PSAnZnVuY3Rpb24nICYmIGlzTGF5ZXJFbnRyeShleHBvcnRlZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhwb3J0ZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICBcbiAgICAgICAgaWYoIWZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSl7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBMYXllckVudHJ5IGZvdW5kIGluIGZpbGUgJHtmaWxlfS4gV2lsbCB1c2UgRGVmYXVsdCBvcHRpb25zLmApO1xuICAgICAgICB9XG5cbiAgICAgICAgTGF5ZXJFbnRyeSh7IFxuICAgICAgICAgICAgbm90R2xvYmFsOiBsYXllckNvbmZpZy5ub3RHbG9iYWwgPz8gZmFsc2UsXG4gICAgICAgICAgICBpc0VudHJ5UGFja2FnZTogbGF5ZXJDb25maWcuaXNFbnRyeVBhY2thZ2UgPz8gZmFsc2VcbiAgICAgICAgfSlcbiAgICAgICAgY2xhc3MgRW1wdHlMYXllckRlc2NyaXB0b3Ige31cblxuICAgICAgICAvLyBpZiBubyBsYXllciBkZXNjcmlwdG9yIGZvdW5kIGluIHRoZSBmaWxlLCBjcmVhdGUgYW4gZW1wdHkgY2xhc3Mgd2hpY2ggd2lsbCB1c2UgZGVmYXVsdCBvcHRpb25zXG4gICAgICAgIGNvbnN0IGxheWVyRGVzY3JpcHRvciA9IGZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSA/IG1vZHVsZUV4cG9ydHNbZm91bmRMYXllckRlc2NyaXB0b3JOYW1lXSA6IEVtcHR5TGF5ZXJEZXNjcmlwdG9yO1xuXG4gICAgICAgIGNvbnN0IGxheWVyTmFtZSA9IGdldExheWVyTmFtZShsYXllckRlc2NyaXB0b3IpIHx8IGZpbGVCYXNlTmFtZTtcbiAgICAgICAgXG4gICAgICAgIC8vIE1lcmdlIGJ1aWxkIG9wdGlvbnM6IGRlZmF1bHRzIDwgY29uc3RydWN0LWxldmVsIDwgZGVjb3JhdG9yLWxldmVsXG4gICAgICAgIGNvbnN0IGRlY29yYXRvckJ1aWxkT3B0aW9ucyA9IGdldExheWVyQnVpbGRPcHRpb25zKGxheWVyRGVzY3JpcHRvcik7XG4gICAgICAgIGNvbnN0IGJ1aWxkT3B0aW9ucyA9IHRoaXMubWVyZ2VCdWlsZE9wdGlvbnMoXG4gICAgICAgICAgICBsYXllck5hbWUsXG4gICAgICAgICAgICBsYXllckNvbmZpZy5idWlsZE9wdGlvbnMsXG4gICAgICAgICAgICBkZWNvcmF0b3JCdWlsZE9wdGlvbnNcbiAgICAgICAgKTtcbiAgICAgICAgXG4gICAgICAgIC8vIERldGVybWluZSBwYWNrYWdlIHN0cnVjdHVyZTpcbiAgICAgICAgLy8gLSBJZiBwYWNrYWdlUGF0aCBpcyBzZXQ6IHVzZSBpdCBhcyB0aGUgZnVsbCBtb2R1bGUgcGF0aCAoZS5nLiwgQHRlbjI0Z3JvdXAvZncyNClcbiAgICAgICAgLy8gLSBJZiBub3Qgc2V0OiB1c2UgZmlsZUJhc2VOYW1lIGFzIHRoZSBwYWNrYWdlIG5hbWUgKGUuZy4sIGRpLCBzaGFyZWQpXG4gICAgICAgIGNvbnN0IHBhY2thZ2VOYW1lID0gbGF5ZXJDb25maWcucGFja2FnZVBhdGggfHwgZmlsZUJhc2VOYW1lO1xuICAgICAgICBjb25zdCBjb25maWd1cmVkT3V0cHV0UGF0aCA9IGBub2RlanMvbm9kZV9tb2R1bGVzLyR7cGFja2FnZU5hbWV9YDtcbiAgICBcbiAgICAgICAgY29uc3Qgb3V0cHV0RGlyID0gcGF0aEpvaW4oZGlzdERpcmVjdG9yeSwgbGF5ZXJOYW1lLCBjb25maWd1cmVkT3V0cHV0UGF0aCk7XG4gICAgICAgIGNvbnN0IGJ1bmRsZURpciA9IHBhdGhKb2luKGRpc3REaXJlY3RvcnksIGxheWVyTmFtZSk7XG5cbiAgICAgICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgICAgIC8vIEJVSUxEIExBWUVSOiBlc2J1aWxkICsgbnBtIGluc3RhbGwgKHdpdGggbnBtIGluc3RhbGwgY2FjaGluZylcbiAgICAgICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIEJ1aWxkaW5nIGxheWVyLi4uYCk7XG4gICAgICAgIGNvbnN0IGJ1aWxkVGltZXIgPSBUaW1lci5zdGFydCgpO1xuXG4gICAgICAgIC8vIEVuc3VyZSBvdXRwdXQgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMob3V0cHV0RGlyKSkge1xuICAgICAgICAgICAgbWtkaXJTeW5jKG91dHB1dERpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJbnN0YWxsIGV4dGVybmFsIGRlcGVuZGVuY2llcyBGSVJTVCAod2l0aCBzbWFydCBjYWNoaW5nIHRvIHNraXAgaWYgdW5jaGFuZ2VkKVxuICAgICAgICBjb25zdCBleHRlcm5hbFBhY2thZ2VzID0gKGJ1aWxkT3B0aW9ucy5leHRlcm5hbCAmJiBBcnJheS5pc0FycmF5KGJ1aWxkT3B0aW9ucy5leHRlcm5hbCkpID8gYnVpbGRPcHRpb25zLmV4dGVybmFsIDogW107XG4gICAgICAgIGlmIChleHRlcm5hbFBhY2thZ2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbGxUaW1lciA9IFRpbWVyLnN0YXJ0KCk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBbMS8yXSBJbnN0YWxsaW5nIGV4dGVybmFsIGRlcGVuZGVuY2llcy4uLmApO1xuICAgICAgICAgICAgYXdhaXQgaW5zdGFsbEV4dGVybmFsRGVwZW5kZW5jaWVzT3B0aW1pemVkKGJ1bmRsZURpciwgZXh0ZXJuYWxQYWNrYWdlcywgdGhpcy5sb2dnZXIpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gICAg4pyTIERlcGVuZGVuY2llcyBpbnN0YWxsZWQgKCR7aW5zdGFsbFRpbWVyLmVsYXBzZWRTZWNvbmRzKCl9KWApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVGhlbiBidW5kbGUgYXBwbGljYXRpb24gY29kZSBpbnRvIG5vZGVfbW9kdWxlc1xuICAgICAgICBjb25zdCBvdXRwdXRGaWxlID0gcGF0aEpvaW4ob3V0cHV0RGlyLCAnaW5kZXguanMnKTtcbiAgICAgICAgY29uc3QgYnVuZGxlVGltZXIgPSBUaW1lci5zdGFydCgpO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBbMi8yXSBCdW5kbGluZyB3aXRoIGVzYnVpbGQuLi5gKTtcbiAgICAgICAgYXdhaXQgYnVuZGxlV2l0aEVzYnVpbGQoZmlsZSwgb3V0cHV0RmlsZSwgYnVpbGRPcHRpb25zKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gICAg4pyTIEJ1bmRsZSBjb21wbGV0ZSAoJHtidW5kbGVUaW1lci5lbGFwc2VkU2Vjb25kcygpfSlgKTtcbiAgICAgICAgXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIOKckyBCdWlsZCBjb21wbGV0ZSBpbiAke2J1aWxkVGltZXIuZWxhcHNlZFNlY29uZHMoKX1gKVxuXG4gICAgICAgIC8vIEltcG9ydCBwYXRoOiAvb3B0L25vZGVqcy9ub2RlX21vZHVsZXMve3BhY2thZ2VOYW1lfS9pbmRleC5qc1xuICAgICAgICAvLyBOb2RlLmpzIHdpbGwgcmVzb2x2ZSB0aGlzIHRvIHRoZSBidW5kbGVkIGVudHJ5IHBvaW50XG4gICAgICAgIGNvbnN0IGxheWVySW1wb3J0UGF0aCA9IHBhdGhKb2luKCcvb3B0JywgY29uZmlndXJlZE91dHB1dFBhdGgsICdpbmRleC5qcycpO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBMYXllciBpbXBvcnQgcGF0aDogJHtsYXllckltcG9ydFBhdGh9YCk7XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUobGF5ZXJOYW1lLCBsYXllckltcG9ydFBhdGgsICdsYXllckltcG9ydFBhdGgnKTtcblxuICAgICAgICBpZihpc0dsb2JhbExheWVyKGxheWVyRGVzY3JpcHRvcikpe1xuICAgICAgICAgICAgLy8gQXR0YWNoIHRoaXMgbGF5ZXIgdG8gYWxsIExhbWJkYSBmdW5jdGlvbnNcbiAgICAgICAgICAgIHRoaXMuZncyNC5hZGRHbG9iYWxMYW1iZGFMYXllck5hbWVzKGxheWVyTmFtZSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIE9ubHkgYWRkIGFzIGVudHJ5IHBhY2thZ2UgaWYgaXQgbmVlZHMgdG8gZXhlY3V0ZSBhdCBtb2R1bGUgaW5pdGlhbGl6YXRpb25cbiAgICAgICAgICAgIGlmIChpc0VudHJ5UGFja2FnZShsYXllckRlc2NyaXB0b3IpKSB7XG4gICAgICAgICAgICAvLyBjb2xsZWN0IGdsb2JhbCBlbnRyeS1wYWNrYWdlcyBmb3IgbGFtYmRhcyB3aXRoIHByaW9yaXR5IGZvciBjb3JyZWN0IGxvYWRpbmcgb3JkZXJcbiAgICAgICAgICAgIC8vIFByaW9yaXR5IGlzIGFsd2F5cyBzZXQgaW4gY29uc3RydWN0KCksIHNvIGl0IG11c3QgYmUgZGVmaW5lZCBoZXJlXG4gICAgICAgICAgICBpZiAobGF5ZXJDb25maWcucHJpb3JpdHkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTGF5ZXIgJHtsYXllck5hbWV9IGhhcyBubyBwcmlvcml0eS4gVGhpcyBzaG91bGQgbmV2ZXIgaGFwcGVuLmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5mdzI0LmFkZEdsb2JhbExhbWJkYUVudHJ5UGFja2FnZShgZW52OmxheWVySW1wb3J0UGF0aDoke2xheWVyTmFtZX1gLCBsYXllckNvbmZpZy5wcmlvcml0eSk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gUmVnaXN0ZXJlZCBhcyBlbnRyeSBwYWNrYWdlIChwcmlvcml0eTogJHtsYXllckNvbmZpZy5wcmlvcml0eX0pYCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIExheWVyIGF0dGFjaGVkIGJ1dCBOT1QgYW4gZW50cnkgcGFja2FnZSAoYXZhaWxhYmxlIGZvciBpbXBvcnQgb25seSlgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxheWVyUHJvcHMgPSBnZXRMYXllclByb3BzKGxheWVyRGVzY3JpcHRvcik7XG5cbiAgICAgICAgY29uc3QgZGVmYXVsdExheWVyUHJvcHM6IExheWVyVmVyc2lvblByb3BzID0ge1xuICAgICAgICAgICAgbGF5ZXJWZXJzaW9uTmFtZTogbGF5ZXJOYW1lLFxuICAgICAgICAgICAgY29tcGF0aWJsZVJ1bnRpbWVzOiBbIFJ1bnRpbWUuTk9ERUpTXzIyX1ggXSxcbiAgICAgICAgICAgIGNvZGU6IENvZGUuZnJvbUFzc2V0KGJ1bmRsZURpciksXG4gICAgICAgICAgICBjb21wYXRpYmxlQXJjaGl0ZWN0dXJlczogW0FyY2hpdGVjdHVyZS5BUk1fNjRdLFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGxheWVyID0gbmV3IExheWVyVmVyc2lvbih0aGlzLm1haW5TdGFjaywgbGF5ZXJOYW1lICsgJy1sYXllcicsIHtcbiAgICAgICAgICAgIC4uLmRlZmF1bHRMYXllclByb3BzLFxuICAgICAgICAgICAgLi4ubGF5ZXJDb25maWcubGF5ZXJQcm9wcyxcbiAgICAgICAgICAgIC4uLmxheWVyUHJvcHMsIC8vIHRoZSBsYXllclByb3BzIGZyb20gdGhlIGRlY29yYXRvciB0YWtlIHByZWNlZGVuY2VcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBsYXllck5hbWUsIGxheWVyLCBPdXRwdXRUeXBlLkxBWUVSLCAnbGF5ZXJWZXJzaW9uQXJuJyk7XG5cbiAgICAgICAgLy8gQ2xlYW4gdXAgdGhlIHRlbXBvcmFyeSBvdXRwdXQgZGlyZWN0b3J5IGlmIGNvbmZpZ3VyZWRcbiAgICAgICAgaWYgKGxheWVyQ29uZmlnLmNsZWFyT3V0cHV0RGlyKSB7XG4gICAgICAgICAgICBjbGVhbnVwRGlyZWN0b3J5KG91dHB1dERpcik7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qKlxuICogUmVjdXJzaXZlbHkgc2NhbnMgYSBkaXJlY3RvcnkgYW5kIHJldHVybnMgYSBsaXN0IG9mIFR5cGVTY3JpcHQgZmlsZXMuXG4gKiBAcGFyYW0gZGlyZWN0b3J5IC0gVGhlIGRpcmVjdG9yeSB0byBzY2FuLlxuICogQHJldHVybnMgQW4gYXJyYXkgb2YgVHlwZVNjcmlwdCBmaWxlIHBhdGhzLlxuICovXG5mdW5jdGlvbiBzY2FuRGlyZWN0b3J5KGRpcmVjdG9yeTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGxldCBmaWxlczogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBpdGVtcyA9IHJlYWRkaXJTeW5jKGRpcmVjdG9yeSk7XG5cbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICAgICAgY29uc3QgZnVsbFBhdGggPSBwYXRoSm9pbihkaXJlY3RvcnksIGl0ZW0pO1xuICAgICAgICBjb25zdCBzdGF0ID0gc3RhdFN5bmMoZnVsbFBhdGgpO1xuXG4gICAgICAgIGlmIChzdGF0LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIGZpbGVzID0gZmlsZXMuY29uY2F0KHNjYW5EaXJlY3RvcnkoZnVsbFBhdGgpKTtcbiAgICAgICAgfSBlbHNlIGlmIChzdGF0LmlzRmlsZSgpICYmIGZ1bGxQYXRoLmVuZHNXaXRoKCcudHMnKSkge1xuICAgICAgICAgICAgZmlsZXMucHVzaChmdWxsUGF0aCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmlsZXM7XG59XG5cbmZ1bmN0aW9uIGlzTGF5ZXJFbnRyeSh0YXJnZXQ6IEZ1bmN0aW9uKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuICEhZ2V0TGF5ZXJOYW1lKHRhcmdldCk7XG59XG5cbmZ1bmN0aW9uIGlzR2xvYmFsTGF5ZXIodGFyZ2V0OiBGdW5jdGlvbik6IGJvb2xlYW4ge1xuICAgIHJldHVybiAhUmVmbGVjdC5nZXQodGFyZ2V0LCAnbm90R2xvYmFsJyk7XG59XG5cbmZ1bmN0aW9uIGlzRW50cnlQYWNrYWdlKHRhcmdldDogRnVuY3Rpb24pOiBib29sZWFuIHtcbiAgICBjb25zdCB2YWx1ZSA9IFJlZmxlY3QuZ2V0KHRhcmdldCwgJ2lzRW50cnlQYWNrYWdlJyk7XG4gICAgLy8gRGVmYXVsdCB0byB0cnVlIGlmIG5vdCBzcGVjaWZpZWRcbiAgICByZXR1cm4gdmFsdWUgIT09IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBnZXRMYXllck5hbWUodGFyZ2V0OiBGdW5jdGlvbikge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsICdsYXllck5hbWUnKTtcbn1cblxuZnVuY3Rpb24gZ2V0TGF5ZXJCdWlsZE9wdGlvbnModGFyZ2V0OiBGdW5jdGlvbik6IEJ1aWxkT3B0aW9ucyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRhcmdldCwgJ2J1aWxkT3B0aW9ucycpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGF5ZXJQcm9wcyh0YXJnZXQ6IEZ1bmN0aW9uKTogTGF5ZXJWZXJzaW9uUHJvcHMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsICdsYXllclByb3BzJyk7XG59XG5cbi8qKlxuICogQnVuZGxlcyBhIFR5cGVTY3JpcHQgZmlsZSB1c2luZyBlc2J1aWxkIHdpdGggdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBCdWlsZCBvcHRpb25zIHNob3VsZCBhbHJlYWR5IGJlIG1lcmdlZCB2aWEgbWVyZ2VCdWlsZE9wdGlvbnMoKS5cbiAqIEBwYXJhbSBlbnRyeUZpbGUgLSBUaGUgZW50cnkgZmlsZSB0byBidW5kbGUuXG4gKiBAcGFyYW0gb3V0cHV0RmlsZSAtIFRoZSBvdXRwdXQgZmlsZSBwYXRoIGZvciB0aGUgYnVuZGxlLlxuICogQHBhcmFtIGJ1aWxkT3B0aW9ucyAtIFByZS1tZXJnZWQgYnVpbGQgb3B0aW9ucyBmb3IgZXNidWlsZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gYnVuZGxlV2l0aEVzYnVpbGQoZW50cnlGaWxlOiBzdHJpbmcsIG91dHB1dEZpbGU6IHN0cmluZywgYnVpbGRPcHRpb25zOiBCdWlsZE9wdGlvbnMpIHtcbiAgICBjb25zdCBmaW5hbE9wdGlvbnM6IEJ1aWxkT3B0aW9ucyA9IHtcbiAgICAgICAgLi4uYnVpbGRPcHRpb25zLFxuICAgICAgICBvdXRmaWxlOiBvdXRwdXRGaWxlLFxuICAgICAgICBlbnRyeVBvaW50czogW2VudHJ5RmlsZV0sXG4gICAgfTtcblxuICAgIERlZmF1bHRMb2dnZXIuZGVidWcoYGJ1bmRsZVdpdGhFc2J1aWxkOiAke2VudHJ5RmlsZX0g4oaSICR7b3V0cHV0RmlsZX1gKTtcbiAgICBcbiAgICB0cnkge1xuICAgICAgICBhd2FpdCBidWlsZChmaW5hbE9wdGlvbnMpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBidW5kbGUgJHtlbnRyeUZpbGV9OmAsIGVycm9yKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBlc2J1aWxkIGZhaWxlZCBmb3IgJHtlbnRyeUZpbGV9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgICB9XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlcyBoYXNoIG9mIGEgZmlsZSdzIGNvbnRlbnRzXG4gKi9cbmZ1bmN0aW9uIGNhbGN1bGF0ZUZpbGVIYXNoKGZpbGVQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkRmlsZVN5bmMoZmlsZVBhdGgpO1xuICAgIHJldHVybiBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoY29udGVudCkuZGlnZXN0KCdoZXgnKTtcbn1cblxuLyoqXG4gKiBIYXNoZXMgYSBkaXJlY3RvcnkncyBjb250ZW50cyByZWN1cnNpdmVseSBmb3IgY2hhbmdlIGRldGVjdGlvblxuICogVXNlZCBmb3IgbG9jYWwgcGFja2FnZSBkZXBlbmRlbmNpZXMgdG8gZGV0ZWN0IHdoZW4gdGhleSd2ZSBiZWVuIHJlYnVpbHRcbiAqIEBwYXJhbSBkaXJQYXRoIC0gRGlyZWN0b3J5IHRvIGhhc2ggKHR5cGljYWxseSBhIGRpc3QgZm9sZGVyKVxuICogQHJldHVybnMgU0hBLTI1NiBoYXNoIG9mIGFsbCBmaWxlIGNvbnRlbnRzXG4gKi9cbi8qKlxuICogUmVjdXJzaXZlbHkgaGFzaGVzIHRoZSBjb250ZW50cyBvZiBhIGRpcmVjdG9yeSBmb3IgY2hhbmdlIGRldGVjdGlvbi5cbiAqIFNraXBzIGNvbW1vbiBub24tcnVudGltZSBkaXJlY3RvcmllcyAobm9kZV9tb2R1bGVzLCAuZ2l0LCB0ZXN0LCBldGMuKVxuICogUmV0dXJucyBjb25zaXN0ZW50IFNIQS0yNTYgaGFzaCBldmVuIGZvciBlbXB0eSBkaXJlY3Rvcmllcy5cbiAqIFxuICogQHBhcmFtIGRpclBhdGggLSBBYnNvbHV0ZSBwYXRoIHRvIGRpcmVjdG9yeSB0byBoYXNoXG4gKiBAcmV0dXJucyBTSEEtMjU2IGhhc2ggKDY0IGhleCBjaGFyYWN0ZXJzKVxuICovXG5mdW5jdGlvbiBoYXNoRGlyZWN0b3J5Q29udGVudHMoZGlyUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBoYXNoID0gY3JlYXRlSGFzaCgnc2hhMjU2Jyk7XG4gICAgbGV0IGZpbGVDb3VudCA9IDA7XG4gICAgXG4gICAgY29uc3QgaGFzaERpclJlY3Vyc2l2ZSA9IChjdXJyZW50UGF0aDogc3RyaW5nKSA9PiB7XG4gICAgICAgIGlmICghZXhpc3RzU3luYyhjdXJyZW50UGF0aCkpIHJldHVybjtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHN0YXQgPSBsc3RhdFN5bmMoY3VycmVudFBhdGgpO1xuICAgICAgICBcbiAgICAgICAgaWYgKHN0YXQuaXNTeW1ib2xpY0xpbmsoKSkge1xuICAgICAgICAgICAgLy8gU2tpcCBzeW1saW5rcyB0byBhdm9pZCBpbmZpbml0ZSBsb29wcyBhbmQgaW5jb25zaXN0ZW50IGJlaGF2aW9yXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmIChzdGF0LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGl0ZW1zID0gcmVhZGRpclN5bmMoY3VycmVudFBhdGgpLnNvcnQoKGEsIGIpID0+IGEubG9jYWxlQ29tcGFyZShiKSk7IC8vIFNvcnQgZm9yIGRldGVybWluaXN0aWMgaGFzaGluZ1xuICAgICAgICAgICAgZm9yKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICAgICAgICAgICAgICAvLyBTa2lwIGNvbW1vbiBkaXJlY3RvcmllcyB0aGF0IGRvbid0IGFmZmVjdCBydW50aW1lXG4gICAgICAgICAgICAgICAgaWYgKGl0ZW0gPT09ICdub2RlX21vZHVsZXMnIHx8IGl0ZW0gPT09ICcuZ2l0JyB8fCBcbiAgICAgICAgICAgICAgICAgICAgaXRlbSA9PT0gJ3Rlc3QnIHx8IGl0ZW0gPT09ICdfX3Rlc3RzX18nIHx8IFxuICAgICAgICAgICAgICAgICAgICBpdGVtID09PSAnY292ZXJhZ2UnIHx8IGl0ZW0gPT09ICcuRFNfU3RvcmUnKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaGFzaERpclJlY3Vyc2l2ZShwYXRoSm9pbihjdXJyZW50UGF0aCwgaXRlbSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHN0YXQuaXNGaWxlKCkpIHtcbiAgICAgICAgICAgIGZpbGVDb3VudCsrO1xuICAgICAgICAgICAgLy8gSGFzaCBmaWxlIHBhdGggKHJlbGF0aXZlKSBmb3IgdW5pcXVlbmVzc1xuICAgICAgICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcGF0aFJlbGF0aXZlKGRpclBhdGgsIGN1cnJlbnRQYXRoKTtcbiAgICAgICAgICAgIGhhc2gudXBkYXRlKHJlbGF0aXZlUGF0aCk7XG4gICAgICAgICAgICAvLyBIYXNoIGZpbGUgY29udGVudHNcbiAgICAgICAgICAgIGhhc2gudXBkYXRlKHJlYWRGaWxlU3luYyhjdXJyZW50UGF0aCkpO1xuICAgICAgICB9XG4gICAgfTtcbiAgICBcbiAgICAvLyBIYXNoIHRoZSBkaXJlY3RvcnkgcGF0aCBpdHNlbGYgZmlyc3QgZm9yIHVuaXF1ZW5lc3NcbiAgICBoYXNoLnVwZGF0ZShkaXJQYXRoKTtcbiAgICBoYXNoRGlyUmVjdXJzaXZlKGRpclBhdGgpO1xuICAgIFxuICAgIC8vIElmIG5vIGZpbGVzIHdlcmUgZm91bmQsIHVwZGF0ZSBoYXNoIHdpdGggc2VudGluZWwgdmFsdWVcbiAgICAvLyBUaGlzIGVuc3VyZXMgZW1wdHkgZGlyZWN0b3JpZXMgaGF2ZSBhIGRpZmZlcmVudCBoYXNoIHRoYW4gbm9uLWV4aXN0ZW50IG9uZXNcbiAgICBpZiAoZmlsZUNvdW50ID09PSAwKSB7XG4gICAgICAgIGhhc2gudXBkYXRlKCdfX0VNUFRZX0RJUkVDVE9SWV9fJyk7XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBoYXNoLmRpZ2VzdCgnaGV4Jyk7XG59XG5cblxuLyoqXG4gKiBDbGVhbnMgdXAgYSB0ZW1wb3JhcnkgZGlyZWN0b3J5IGJ5IHJlbW92aW5nIGFsbCBmaWxlcyBhbmQgc3ViZGlyZWN0b3JpZXMuXG4gKiBAcGFyYW0gZGlyZWN0b3J5IC0gVGhlIGRpcmVjdG9yeSB0byBjbGVhbiB1cC5cbiAqL1xuZnVuY3Rpb24gY2xlYW51cERpcmVjdG9yeShkaXJlY3Rvcnk6IHN0cmluZykge1xuICAgIHRyeSB7XG4gICAgICAgIHJtU3luYyhkaXJlY3RvcnksIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBidW5kbGVXaXRoRXNidWlsZDogQ2xlYW5lZCB1cCB0ZW1wb3JhcnkgZGlyZWN0b3J5OiAke2RpcmVjdG9yeX1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmVycm9yKGBidW5kbGVXaXRoRXNidWlsZDogRmFpbGVkIHRvIGNsZWFuIHVwIGRpcmVjdG9yeSAke2RpcmVjdG9yeX06YCwgZXJyb3IpO1xuICAgIH1cbn1cblxuLyoqXG4gKiBPUFRJTUlaRUQ6IEluc3RhbGxzIGV4dGVybmFsIGRlcGVuZGVuY2llcyB3aXRoIGludGVsbGlnZW50IGNhY2hpbmdcbiAqIFxuICogQHBhcmFtIGxheWVyT3V0cHV0RGlyIC0gVGhlIE9VVFBVVCBkaXJlY3RvcnkgZm9yIHRoZSBsYXllciAoZS5nLiwgZGlzdC9sYXllcnMvZGkpXG4gKiBAcGFyYW0gZXh0ZXJuYWxQYWNrYWdlcyAtIEFycmF5IG9mIHBhY2thZ2UgbmFtZXMgdG8gaW5zdGFsbCAoZS5nLiwgWydheGlvcycsICdmaXJlYmFzZS1hZG1pbiddKVxuICogQHBhcmFtIGxvZ2dlciAtIExvZ2dlciBpbnN0YW5jZSBmb3Igb3V0cHV0XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGluc3RhbGxFeHRlcm5hbERlcGVuZGVuY2llc09wdGltaXplZChsYXllck91dHB1dERpcjogc3RyaW5nLCBleHRlcm5hbFBhY2thZ2VzOiAoc3RyaW5nIHwgUmVnRXhwKVtdLCBsb2dnZXI6IGFueSkge1xuICAgIC8vIEZpbHRlciBvdXQgcmVnZXggcGF0dGVybnMsIGZyYW1ld29yayBwYWNrYWdlcywgYW5kIHBhY2thZ2VzIHByb3ZpZGVkIGJ5IG90aGVyIGxheWVyc1xuICAgIGNvbnN0IHBhY2thZ2VOYW1lcyA9IGV4dGVybmFsUGFja2FnZXMuZmlsdGVyKHBrZyA9PiBcbiAgICAgICAgdHlwZW9mIHBrZyA9PT0gJ3N0cmluZycgJiYgXG4gICAgICAgICFwa2cuc3RhcnRzV2l0aCgnQGF3cy1zZGsnKSAmJiAgICAgIC8vIFByb3ZpZGVkIGJ5IExhbWJkYSBydW50aW1lXG4gICAgICAgICFwa2cuc3RhcnRzV2l0aCgnQHNtaXRoeScpICYmICAgICAgIC8vIFByb3ZpZGVkIGJ5IExhbWJkYSBydW50aW1lXG4gICAgICAgICFwa2cuc3RhcnRzV2l0aCgnYXdzLWNkay1saWInKSAmJiAgIC8vIEJ1aWxkLXRpbWUgb25seVxuICAgICAgICBwa2cgIT09ICdlc2J1aWxkJyAmJiAgICAgICAgICAgICAgICAvLyBCdWlsZC10aW1lIG9ubHlcbiAgICAgICAgcGtnICE9PSAnQHRlbjI0Z3JvdXAvZncyNCcgICAgICAgICAgLy8gUHJvdmlkZWQgYnkgZncyNCBydW50aW1lIGxheWVyIChub3QgZGkgbGF5ZXIpXG4gICAgKSBhcyBzdHJpbmdbXTtcblxuICAgIGlmIChwYWNrYWdlTmFtZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBub2RlanNEaXIgPSBwYXRoSm9pbihsYXllck91dHB1dERpciwgJ25vZGVqcycpO1xuICAgIGNvbnN0IG5vZGVNb2R1bGVzRGlyID0gcGF0aEpvaW4obm9kZWpzRGlyLCAnbm9kZV9tb2R1bGVzJyk7XG4gICAgY29uc3QgcGFja2FnZUpzb25QYXRoID0gcGF0aEpvaW4obm9kZWpzRGlyLCAncGFja2FnZS5qc29uJyk7XG4gICAgY29uc3QgcGFja2FnZUhhc2hQYXRoID0gcGF0aEpvaW4obm9kZWpzRGlyLCAnLnBhY2thZ2UtaGFzaCcpO1xuICAgIFxuICAgIC8vIEJ1aWxkIGRlc2lyZWQgcGFja2FnZS5qc29uXG4gICAgY29uc3QgcGFja2FnZUpzb246IGFueSA9IHtcbiAgICAgICAgbmFtZTogJ2xheWVyLWRlcGVuZGVuY2llcycsXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXG4gICAgICAgIGRlcGVuZGVuY2llczoge31cbiAgICB9O1xuXG4gICAgLy8gUmVhZCB0aGUgcHJvamVjdCdzIHBhY2thZ2UuanNvbiB0byBnZXQgdmVyc2lvbiBudW1iZXJzXG4gICAgY29uc3QgcHJvamVjdFJvb3QgPSBwYXRoUmVzb2x2ZShwcm9jZXNzLmN3ZCgpKTtcbiAgICBjb25zdCBwcm9qZWN0UGFja2FnZUpzb25QYXRoID0gcGF0aEpvaW4ocHJvamVjdFJvb3QsICdwYWNrYWdlLmpzb24nKTtcbiAgICBcbiAgICAvLyBUcmFjayBsb2NhbCBwYWNrYWdlIGNvbnRlbnQgaGFzaGVzIGZvciBjaGFuZ2UgZGV0ZWN0aW9uXG4gICAgY29uc3QgbG9jYWxQYWNrYWdlSGFzaGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gICAgXG4gICAgaWYgKCFleGlzdHNTeW5jKHByb2plY3RQYWNrYWdlSnNvblBhdGgpKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKGBwYWNrYWdlLmpzb24gbm90IGZvdW5kIGF0ICR7cHJvamVjdFBhY2thZ2VKc29uUGF0aH0sIGluc3RhbGxpbmcgbGF0ZXN0IHZlcnNpb25zYCk7XG4gICAgICAgIGZvcihjb25zdCBwa2cgb2YgcGFja2FnZU5hbWVzKSB7XG4gICAgICAgICAgICBwYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXNbcGtnXSA9ICdsYXRlc3QnO1xuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgcHJvamVjdFBhY2thZ2VKc29uID0gSlNPTi5wYXJzZShyZWFkRmlsZVN5bmMocHJvamVjdFBhY2thZ2VKc29uUGF0aCwgJ3V0Zi04JykpO1xuICAgICAgICAvLyBPTkxZIHVzZSBydW50aW1lIGRlcGVuZGVuY2llcyAtIGRldkRlcGVuZGVuY2llcyBhcmUgYnVpbGQtdGltZSB0b29scywgbm90IExhbWJkYSBydW50aW1lIVxuICAgICAgICBjb25zdCBydW50aW1lRGVwcyA9IHByb2plY3RQYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXMgfHwge307XG5cbiAgICAgICAgZm9yKGNvbnN0IHBrZyBvZiBwYWNrYWdlTmFtZXMpIHtcbiAgICAgICAgICAgIGlmIChydW50aW1lRGVwc1twa2ddKSB7XG4gICAgICAgICAgICAgICAgbGV0IGRlcFZhbHVlID0gcnVudGltZURlcHNbcGtnXTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBIYW5kbGUgbG9jYWwgZmlsZXN5c3RlbSBkZXBlbmRlbmNpZXMgKGUuZy4sIFwiLi4vZncyNC9cIiwgXCJmaWxlOi4uL2Z3MjRcIiwgb3IgXCIuLlxcZncyNFwiIG9uIFdpbmRvd3MpXG4gICAgICAgICAgICAgICAgY29uc3QgaXNMb2NhbERlcCA9IGRlcFZhbHVlLnN0YXJ0c1dpdGgoJ2ZpbGU6JykgfHwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXBWYWx1ZS5zdGFydHNXaXRoKCcuLi8nKSB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlcFZhbHVlLnN0YXJ0c1dpdGgoJy4vJykgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlcFZhbHVlLnN0YXJ0c1dpdGgoJy4uXFxcXCcpIHx8IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVwVmFsdWUuc3RhcnRzV2l0aCgnLlxcXFwnKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoaXNMb2NhbERlcCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBsb2NhbFBhdGggPSBkZXBWYWx1ZS5yZXBsYWNlKCdmaWxlOicsICcnKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gUmVzb2x2ZSBhYnNvbHV0ZSBwYXRoIG9mIHRoZSBsb2NhbCBwYWNrYWdlXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHBhdGhSZXNvbHZlKHByb2plY3RSb290LCBsb2NhbFBhdGgpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gVmFsaWRhdGUgbG9jYWwgcGFja2FnZSBleGlzdHNcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGFic29sdXRlUGF0aCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTXNnID0gW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGDinYwgTG9jYWwgcGFja2FnZSBcIiR7cGtnfVwiIHBhdGggZG9lcyBub3QgZXhpc3Q6ICR7YWJzb2x1dGVQYXRofWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIFNwZWNpZmllZCBpbiBwYWNrYWdlLmpzb24gYXM6ICR7ZGVwVmFsdWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAgUmVzb2x2ZWQgZnJvbSBwcm9qZWN0IHJvb3Q6ICR7cHJvamVjdFJvb3R9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAgUGxlYXNlIGVuc3VyZSB0aGUgbG9jYWwgcGFja2FnZSBwYXRoIGlzIGNvcnJlY3QuYFxuICAgICAgICAgICAgICAgICAgICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvZ2dlci5lcnJvcihlcnJvck1zZyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYExvY2FsIHBhY2thZ2UgcGF0aCBub3QgZm91bmQ6ICR7cGtnfSAtPiAke2Fic29sdXRlUGF0aH1gKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gQ1JJVElDQUw6IFZhbGlkYXRlIHRoYXQgbG9jYWwgcGFja2FnZSBpcyBidWlsdCAoaGFzIGRpc3QgZm9sZGVyKVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXN0UGF0aCA9IHBhdGhKb2luKGFic29sdXRlUGF0aCwgJ2Rpc3QnKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGRpc3RQYXRoKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNc2cgPSBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYOKdjCBMb2NhbCBwYWNrYWdlIFwiJHtwa2d9XCIgaGFzIG5vIGRpc3QgZm9sZGVyOiAke2Rpc3RQYXRofWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIExvY2FsIHBhY2thZ2VzIE1VU1QgYmUgYnVpbHQgYmVmb3JlIGJlaW5nIHVzZWQgYXMgZGVwZW5kZW5jaWVzLmAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIFBsZWFzZSBydW4gdGhlIGJ1aWxkIGNvbW1hbmQgaW46ICR7YWJzb2x1dGVQYXRofWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIEV4YW1wbGU6IGNkICR7YWJzb2x1dGVQYXRofSAmJiBucG0gcnVuIGJ1aWxkYFxuICAgICAgICAgICAgICAgICAgICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvZ2dlci5lcnJvcihlcnJvck1zZyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYExvY2FsIHBhY2thZ2Ugbm90IGJ1aWx0OiAke3BrZ30gKG1pc3NpbmcgZGlzdCBmb2xkZXIpYCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIEhhc2ggdGhlIGRpc3QgZm9sZGVyIGNvbnRlbnRzIGZvciBjaGFuZ2UgZGV0ZWN0aW9uXG4gICAgICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGAgICDihpIgSGFzaGluZyBsb2NhbCBwYWNrYWdlIFwiJHtwa2d9XCIgZGlzdCBmb2xkZXIuLi5gKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udGVudEhhc2ggPSBoYXNoRGlyZWN0b3J5Q29udGVudHMoZGlzdFBhdGgpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gVmFsaWRhdGUgaGFzaCBpcyBub24tZW1wdHkgKGRpc3QgZm9sZGVyIGhhcyBhY3R1YWwgZmlsZXMpXG4gICAgICAgICAgICAgICAgICAgIGlmIChjb250ZW50SGFzaD8ubGVuZ3RoICE9PSA2NCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYCAgIOKaoO+4jyAgVW5leHBlY3RlZCBoYXNoIGZvciBcIiR7cGtnfVwiOiAke2NvbnRlbnRIYXNofWApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBsb2NhbFBhY2thZ2VIYXNoZXNbcGtnXSA9IGNvbnRlbnRIYXNoO1xuICAgICAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4oaSIExvY2FsIHBhY2thZ2UgXCIke3BrZ31cIiBoYXNoOiAke2NvbnRlbnRIYXNoLnN1YnN0cmluZygwLCAxMil9Li4uICgke3BrZ30pYCk7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyBDYWxjdWxhdGUgcmVsYXRpdmUgcGF0aCBmcm9tIGxheWVyJ3Mgbm9kZWpzIGRpciB0byBsb2NhbCBwYWNrYWdlXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aEZyb21MYXllciA9IHBhdGhSZWxhdGl2ZShub2RlanNEaXIsIGFic29sdXRlUGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIGRlcFZhbHVlID0gcmVsYXRpdmVQYXRoRnJvbUxheWVyO1xuICAgICAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4oaSIFJlc29sdmVkIGxvY2FsIHBhY2thZ2UgXCIke3BrZ31cIjogJHtyZWxhdGl2ZVBhdGhGcm9tTGF5ZXJ9YCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHBhY2thZ2VKc29uLmRlcGVuZGVuY2llc1twa2ddID0gZGVwVmFsdWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIFBhY2thZ2Ugbm90IGZvdW5kIGluIGRlcGVuZGVuY2llcyAtIHRoaXMgaXMgYSBjb25maWd1cmF0aW9uIGVycm9yXG4gICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNc2cgPSBbXG4gICAgICAgICAgICAgICAgICAgIGDinYwgUGFja2FnZSBcIiR7cGtnfVwiIG5vdCBmb3VuZCBpbiBydW50aW1lIGRlcGVuZGVuY2llcy5gLFxuICAgICAgICAgICAgICAgICAgICBgICAgVGhpcyBwYWNrYWdlIGlzIG1hcmtlZCBhcyAnZXh0ZXJuYWwnIGluIHRoZSBsYXllciBidWlsZCBidXQgaXMgbm90IGluIHBhY2thZ2UuanNvbiBkZXBlbmRlbmNpZXMuYCxcbiAgICAgICAgICAgICAgICAgICAgYCAgIEFkZCBcIiR7cGtnfVwiIHRvIGRlcGVuZGVuY2llcyBpbiBwYWNrYWdlLmpzb24gd2l0aCBhIHNwZWNpZmljIHZlcnNpb24uYCxcbiAgICAgICAgICAgICAgICAgICAgYCAgIEV4YW1wbGU6IG5wbSBpbnN0YWxsICR7cGtnfSAtLXNhdmVgLFxuICAgICAgICAgICAgICAgICAgICBgICAgVGhlbiByZWJ1aWxkIHRoZSBsYXllci5gXG4gICAgICAgICAgICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBsb2dnZXIuZXJyb3IoZXJyb3JNc2cpO1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBydW50aW1lIGRlcGVuZGVuY3k6ICR7cGtnfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IHBhY2thZ2VKc29uQ29udGVudCA9IEpTT04uc3RyaW5naWZ5KHBhY2thZ2VKc29uLCBudWxsLCAyKTtcbiAgICBjb25zdCBoYXNoID0gY3JlYXRlSGFzaCgnc2hhMjU2Jyk7XG4gICAgaGFzaC51cGRhdGUocGFja2FnZUpzb25Db250ZW50KTtcbiAgICBcbiAgICAvLyBDUklUSUNBTDogSW5jbHVkZSBsb2NhbCBwYWNrYWdlIGNvbnRlbnQgaGFzaGVzIGluIHRoZSBjYWNoZSBrZXlcbiAgICAvLyBUaGlzIGVuc3VyZXMgd2UgcmVpbnN0YWxsIHdoZW4gbG9jYWwgcGFja2FnZXMgY2hhbmdlIChlLmcuLCBmdzI0IHVwZGF0ZXMpXG4gICAgaWYgKE9iamVjdC5rZXlzKGxvY2FsUGFja2FnZUhhc2hlcykubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYCAgIOKGkiBJbmNsdWRpbmcgJHtPYmplY3Qua2V5cyhsb2NhbFBhY2thZ2VIYXNoZXMpLmxlbmd0aH0gbG9jYWwgcGFja2FnZSBjb250ZW50IGhhc2hlcyBpbiBjYWNoZSBrZXlgKTtcbiAgICAgICAgZm9yKGNvbnN0IHBrZyBvZiBPYmplY3Qua2V5cyhsb2NhbFBhY2thZ2VIYXNoZXMpLnNvcnQoKGEsIGIpID0+IGEubG9jYWxlQ29tcGFyZShiKSkpIHtcbiAgICAgICAgICAgIGhhc2gudXBkYXRlKGAke3BrZ306JHtsb2NhbFBhY2thZ2VIYXNoZXNbcGtnXX1gKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICBjb25zdCBjdXJyZW50UGFja2FnZUhhc2ggPSBoYXNoLmRpZ2VzdCgnaGV4Jyk7XG4gICAgXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgLy8gRkFTVCBQQVRIOiBDaGVjayBpZiB3ZSBjYW4gc2tpcCBucG0gaW5zdGFsbFxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIGxldCBza2lwUmVhc29uOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICBpZiAoIWV4aXN0c1N5bmMocGFja2FnZUhhc2hQYXRoKSkge1xuICAgICAgICBza2lwUmVhc29uID0gJ05vIHByZXZpb3VzIGhhc2ggZmlsZSBmb3VuZCAoZmlyc3QgYnVpbGQpJztcbiAgICB9IGVsc2UgaWYgKCFleGlzdHNTeW5jKG5vZGVNb2R1bGVzRGlyKSkge1xuICAgICAgICBza2lwUmVhc29uID0gJ25vZGVfbW9kdWxlcyBkaXJlY3Rvcnkgbm90IGZvdW5kJztcbiAgICB9IGVsc2Uge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcHJldmlvdXNIYXNoID0gcmVhZEZpbGVTeW5jKHBhY2thZ2VIYXNoUGF0aCwgJ3V0Zi04JykudHJpbSgpO1xuICAgICAgICAgICAgLy8gVmFsaWRhdGUgaGFzaCBmb3JtYXQgKFNIQS0yNTYgPSA2NCBoZXggY2hhcnMpXG4gICAgICAgICAgICBpZiAocHJldmlvdXNIYXNoLmxlbmd0aCAhPT0gNjQgfHwgIS9eWzAtOWEtZl17NjR9JC8udGVzdChwcmV2aW91c0hhc2gpKSB7XG4gICAgICAgICAgICAgICAgc2tpcFJlYXNvbiA9IGBJbnZhbGlkIGhhc2ggZm9ybWF0IGluIGNhY2hlIGZpbGUgKGdvdCAke3ByZXZpb3VzSGFzaC5sZW5ndGh9IGNoYXJzKWA7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHByZXZpb3VzSGFzaCA9PT0gY3VycmVudFBhY2thZ2VIYXNoKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKckyBEZXBlbmRlbmNpZXMgdW5jaGFuZ2VkLCBza2lwcGluZyBucG0gaW5zdGFsbCAoc2F2ZWQgfjExcylgKTtcbiAgICAgICAgICAgICAgICByZXR1cm47IC8vIEZBU1QgUEFUSCBTVUNDRVNTIVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBza2lwUmVhc29uID0gJ0RlcGVuZGVuY3kgY2hhbmdlcyBkZXRlY3RlZCc7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKGkiBQcmV2aW91cyBoYXNoOiAke3ByZXZpb3VzSGFzaC5zdWJzdHJpbmcoMCwgMTIpfS4uLmApO1xuICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGAgICDihpIgQ3VycmVudCBoYXNoOiAgJHtjdXJyZW50UGFja2FnZUhhc2guc3Vic3RyaW5nKDAsIDEyKX0uLi5gKTtcbiAgICAgICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMobG9jYWxQYWNrYWdlSGFzaGVzKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGAgICDihpIgTG9jYWwgcGFja2FnZXMgaW5jbHVkZWQgaW4gaGFzaDogJHtPYmplY3Qua2V5cyhsb2NhbFBhY2thZ2VIYXNoZXMpLmpvaW4oJywgJyl9YCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICBza2lwUmVhc29uID0gYEZhaWxlZCB0byByZWFkIGhhc2ggZmlsZTogJHtlcnJvci5tZXNzYWdlfWA7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgLy8gU0xPVyBQQVRIOiBOZWVkIHRvIHJ1biBucG0gaW5zdGFsbFxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIGxvZ2dlci5pbmZvKGAgICDwn5OmIFJ1bm5pbmcgbnBtIGluc3RhbGwgKHJlYXNvbjogJHtza2lwUmVhc29ufSlgKTtcbiAgICBsb2dnZXIuaW5mbyhgICAg4oaSIEluc3RhbGxpbmcgJHtwYWNrYWdlTmFtZXMubGVuZ3RofSBwYWNrYWdlKHMpOiAke3BhY2thZ2VOYW1lcy5qb2luKCcsICcpfWApO1xuICAgIFxuICAgIGNvbnN0IGluc3RhbGxTdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgLy8gRW5zdXJlIGRpcmVjdG9yeSBleGlzdHNcbiAgICBpZiAoIWV4aXN0c1N5bmMobm9kZWpzRGlyKSkge1xuICAgICAgICBta2RpclN5bmMobm9kZWpzRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICB9XG5cbiAgICAvLyBXcml0ZSBwYWNrYWdlLmpzb25cbiAgICB3cml0ZUZpbGVTeW5jKHBhY2thZ2VKc29uUGF0aCwgcGFja2FnZUpzb25Db250ZW50KTtcblxuICAgIC8vIEluc3RhbGwgZGVwZW5kZW5jaWVzXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gLS1pbnN0YWxsLWxpbmtzIGlzIG5lZWRlZCB0byBpbnN0YWxsIGxvY2FsIHBhY2thZ2VzIGZyb20gZmlsZTogcmVmZXJlbmNlc1xuICAgICAgICAvLyAtLXByZWZlci1vZmZsaW5lIGlzIG5lZWRlZCB0byBzcGVlZCB1cCB0aGUgaW5zdGFsbGF0aW9uXG4gICAgICAgIC8vIC0tbm8tcGFja2FnZS1sb2NrIGlzIG5lZWRlZCB0byBhdm9pZCBwYWNrYWdlLWxvY2suanNvbiBjb25mbGljdHNcbiAgICAgICAgLy8gLS1vbWl0PWRldiBpcyBuZWVkZWQgdG8gYXZvaWQgaW5zdGFsbGluZyBkZXYgZGVwZW5kZW5jaWVzXG4gICAgICAgIGV4ZWNTeW5jKCducG0gaW5zdGFsbCAtLW9taXQ9ZGV2IC0tbm8tcGFja2FnZS1sb2NrIC0taW5zdGFsbC1saW5rcyAtLXByZWZlci1vZmZsaW5lJywge1xuICAgICAgICAgICAgY3dkOiBub2RlanNEaXIsXG4gICAgICAgICAgICBzdGRpbzogJ2luaGVyaXQnXG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgZWxhcHNlZCA9ICgoRGF0ZS5ub3coKSAtIGluc3RhbGxTdGFydFRpbWUpIC8gMTAwMCkudG9GaXhlZCgxKTtcbiAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKckyBucG0gaW5zdGFsbCBjb21wbGV0ZSBpbiAke2VsYXBzZWR9c2ApO1xuICAgICAgICBcbiAgICAgICAgLy8gU2F2ZSBoYXNoIGZvciBuZXh0IHJ1blxuICAgICAgICB3cml0ZUZpbGVTeW5jKHBhY2thZ2VIYXNoUGF0aCwgY3VycmVudFBhY2thZ2VIYXNoKTtcbiAgICAgICAgXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gaW5zdGFsbCBleHRlcm5hbCBkZXBlbmRlbmNpZXM6JywgZXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG59XG5cbi8qKlxuICogUmVjdXJzaXZlbHkgY29weSBhIGRpcmVjdG9yeVxuICovXG5mdW5jdGlvbiBjb3B5RGlyZWN0b3J5KHNvdXJjZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZykge1xuICAgIGlmICghZXhpc3RzU3luYyh0YXJnZXQpKSB7XG4gICAgICAgIG1rZGlyU3luYyh0YXJnZXQsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cbiAgICBjb25zdCBpdGVtcyA9IHJlYWRkaXJTeW5jKHNvdXJjZSk7XG4gICAgZm9yKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICAgICAgY29uc3Qgc291cmNlUGF0aCA9IHBhdGhKb2luKHNvdXJjZSwgaXRlbSk7XG4gICAgICAgIGNvbnN0IHRhcmdldFBhdGggPSBwYXRoSm9pbih0YXJnZXQsIGl0ZW0pO1xuICAgICAgICBpZiAobHN0YXRTeW5jKHNvdXJjZVBhdGgpLmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIGNvcHlEaXJlY3Rvcnkoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb3B5RmlsZVN5bmMoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCk7XG4gICAgICAgIH1cbiAgICB9XG59XG4iXX0=