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
        const buildStartTime = Date.now();
        // Ensure output directory exists
        if (!(0, node_fs_1.existsSync)(outputDir)) {
            (0, node_fs_1.mkdirSync)(outputDir, { recursive: true });
        }
        // Install external dependencies FIRST (with smart caching to skip if unchanged)
        const externalPackages = (buildOptions.external && Array.isArray(buildOptions.external)) ? buildOptions.external : [];
        if (externalPackages.length > 0) {
            this.logger.info(`[${layerName}] [1/2] Installing external dependencies...`);
            await installExternalDependenciesOptimized(bundleDir, externalPackages, this.logger);
        }
        // Then bundle application code into node_modules
        const outputFile = (0, node_path_1.join)(outputDir, 'index.js');
        this.logger.info(`[${layerName}] [2/2] Bundling with esbuild...`);
        await bundleWithEsbuild(file, outputFile, buildOptions);
        const elapsed = ((Date.now() - buildStartTime) / 1000).toFixed(1);
        this.logger.info(`[${layerName}] ✓ Build complete in ${elapsed}s`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGF5ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9sYXllci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFtZkEsc0NBRUM7QUFuZkQsMkNBQXdDO0FBQ3hDLHVDQUFvQztBQUNwQyx1REFBeUY7QUFDekYsd0NBQStFO0FBQy9FLHVEQUFzRztBQUN0Ryx5Q0FBaUo7QUFDakoscUNBQXFJO0FBQ3JJLDJEQUE4QztBQUM5QyxxQ0FBOEM7QUFDOUMsOENBQTJDO0FBRTNDLDZDQUF5QztBQUN6QywwQ0FBdUM7QUFtSXZDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0EyQkc7QUFDSCxNQUFhLGNBQWM7SUFjTTtJQWJwQixNQUFNLENBQVU7SUFDaEIsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQUcsY0FBYyxDQUFDLElBQUksQ0FBQztJQUMzQixZQUFZLEdBQWEsRUFBRSxDQUFDO0lBQzVCLE1BQU0sQ0FBdUI7SUFFN0IsU0FBUyxDQUFTO0lBRWxCOzs7T0FHRztJQUNILFlBQTZCLE1BQStCLEVBQUUsVUFBb0I7UUFBckQsV0FBTSxHQUFOLE1BQU0sQ0FBeUI7UUFFeEQsSUFBRyxVQUFVLEVBQUMsQ0FBQztZQUNYLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDdkQsQ0FBQzthQUFNLENBQUM7WUFDSixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDcEQsQ0FBQztRQUVELGVBQWU7UUFDZixLQUFJLE1BQU0sV0FBVyxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQzlCLFdBQVcsQ0FBQyxJQUFJLEdBQUcsV0FBVyxDQUFDLElBQUksSUFBSSxtQkFBbUIsQ0FBQztZQUMzRCxJQUFJLFdBQVcsQ0FBQyxJQUFJLEtBQUssbUJBQW1CLEVBQUUsQ0FBQztnQkFDM0MsV0FBVyxDQUFDLGNBQWMsR0FBRyxXQUFXLENBQUMsY0FBYyxJQUFJLEtBQUssQ0FBQztZQUNyRSxDQUFDO1FBQ0wsQ0FBQztRQUVELGVBQU0sQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQzFDLENBQUM7SUFHWSxBQUFOLEtBQUssQ0FBQyxTQUFTO1FBQ2xCLDhGQUE4RjtRQUM5Riw2REFBNkQ7UUFDN0Qsd0VBQXdFO1FBQ3hFLEtBQUksTUFBTSxDQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUM7WUFDdEQsSUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLElBQUksV0FBVyxDQUFDLFFBQVEsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDdEQsV0FBVyxDQUFDLFFBQVEsR0FBRyxLQUFLLEdBQUcsRUFBRSxDQUFDO1lBQ3RDLENBQUM7UUFDTCxDQUFDO1FBRUQscUZBQXFGO1FBQ3JGLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsV0FBVyxFQUFFLEVBQUU7WUFDcEQsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsY0FBYyxFQUFFLFdBQVcsQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUVoSSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsRUFBRSxXQUFXLENBQUMsQ0FBQztZQUVwRCxJQUFJLFdBQVcsQ0FBQyxJQUFJLEtBQUssbUJBQW1CLEVBQUUsQ0FBQztnQkFDM0MsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDN0MsQ0FBQztpQkFBTSxJQUFJLFdBQVcsQ0FBQyxJQUFJLEtBQUssbUJBQW1CLEVBQUUsQ0FBQztnQkFDbEQsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDaEQsQ0FBQztpQkFBTSxDQUFDO2dCQUNKLE1BQU0sSUFBSSxLQUFLLENBQUMsMEJBQTBCLElBQUksQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQzdFLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ1IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsV0FBb0M7UUFDL0QsTUFBTSxpQkFBaUIsR0FBc0I7WUFDekMsZ0JBQWdCLEVBQUUsV0FBVyxDQUFDLFNBQVM7WUFDdkMsa0JBQWtCLEVBQUUsQ0FBRSxvQkFBTyxDQUFDLFdBQVcsQ0FBRTtZQUMzQyxJQUFJLEVBQUUsaUJBQUksQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQztZQUM1Qyx1QkFBdUIsRUFBRSxDQUFDLHlCQUFZLENBQUMsTUFBTSxDQUFDO1NBQ2pELENBQUM7UUFFRixNQUFNLEtBQUssR0FBRyxJQUFJLHlCQUFZLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxXQUFXLENBQUMsU0FBUyxHQUFHLFFBQVEsRUFBRTtZQUM3RSxHQUFHLGlCQUFpQjtZQUNwQixHQUFHLFdBQVcsQ0FBQyxVQUFVO1NBQzVCLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxTQUFTLEVBQUUsS0FBSyxFQUFFLHNCQUFVLENBQUMsS0FBSyxFQUFFLGlCQUFpQixDQUFDLENBQUM7SUFFMUcsQ0FBQztJQUdEOzs7O09BSUc7SUFDSyxLQUFLLENBQUMsbUJBQW1CLENBQUMsV0FBbUM7UUFDakUseUZBQXlGO1FBQ3pGLE1BQU0sYUFBYSxHQUFHLFdBQVcsQ0FBQyxhQUFhLElBQUksSUFBQSxnQkFBUSxFQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsRUFBRSxhQUFhLENBQUMsQ0FBQztRQUMxRixNQUFNLHlCQUF5QixHQUFHLElBQUEsbUJBQVcsRUFBQyxXQUFXLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDdEUsTUFBTSxPQUFPLEdBQUcsSUFBQSxtQkFBUyxFQUFDLHlCQUF5QixDQUFDLENBQUMsV0FBVyxFQUFFO1lBQzlELENBQUMsQ0FBQyxhQUFhLENBQUMseUJBQXlCLENBQUM7WUFDMUMsQ0FBQyxDQUFDLENBQUMseUJBQXlCLENBQUMsQ0FBQztRQUVsQyxxRUFBcUU7UUFDckUsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxFQUFFO1lBQ3pDLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLElBQUksRUFBRSxhQUFhLEVBQUUsV0FBVyxDQUFDLENBQUM7UUFDdkUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNSLENBQUM7SUFHRDs7Ozs7O09BTUc7SUFDSyxpQkFBaUIsQ0FDckIsU0FBaUIsRUFDakIscUJBQW9DLEVBQ3BDLHFCQUFvQztRQUVwQyx1Q0FBdUM7UUFDdkMsTUFBTSxtQkFBbUIsR0FBaUI7WUFDdEMsTUFBTSxFQUFFLElBQUk7WUFDWixRQUFRLEVBQUUsTUFBTTtZQUNoQixNQUFNLEVBQUUsUUFBUTtZQUNoQixNQUFNLEVBQUUsS0FBSztZQUNiLFNBQVMsRUFBRSxLQUFLO1lBQ2hCLFFBQVEsRUFBRTtnQkFDTixvREFBb0Q7Z0JBQ3BELGtCQUFrQjtnQkFDbEIsMEJBQTBCO2dCQUMxQixVQUFVO2dCQUNWLFNBQVM7Z0JBQ1QsYUFBYTtnQkFDYixTQUFTO2FBQ1o7U0FDSixDQUFDO1FBRUYsMkNBQTJDO1FBQzNDLE1BQU0sTUFBTSxHQUFHLENBQUMsSUFBQSxhQUFLLEVBQUM7WUFDbEIsbUJBQW1CO1lBQ25CLHFCQUFxQixJQUFJLEVBQUU7WUFDM0IscUJBQXFCLElBQUksRUFBRTtTQUM5QixDQUFDLElBQUksbUJBQW1CLENBQUMsQ0FBQztRQUUzQiwyQkFBMkI7UUFDM0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxTQUFTLHlCQUF5QixFQUFFO1lBQ3RELFNBQVMsRUFBRSxNQUFNLENBQUMsU0FBUztZQUMzQixNQUFNLEVBQUUsTUFBTSxDQUFDLE1BQU07WUFDckIsUUFBUSxFQUFFLE1BQU0sQ0FBQyxRQUFRO1lBQ3pCLFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUTtZQUN6QixNQUFNLEVBQUUsTUFBTSxDQUFDLE1BQU07U0FDeEIsQ0FBQyxDQUFDO1FBRUgsT0FBTyxNQUFNLENBQUM7SUFDbEIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNLLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxJQUFZLEVBQUUsYUFBcUIsRUFBRSxXQUFtQztRQUN4RyxNQUFNLFlBQVksR0FBRyxJQUFBLG9CQUFZLEVBQUMsSUFBSSxFQUFFLElBQUEsbUJBQVcsRUFBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQzNELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHFCQUFxQixZQUFZLEVBQUUsQ0FBQyxDQUFDO1FBRXRELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLGlDQUFpQyxJQUFJLEtBQUssQ0FBQyxDQUFDO1FBQzlELE1BQU0sYUFBYSxHQUFHLHlCQUFhLElBQUksdUNBQUMsQ0FBQztRQUN6QyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO1FBRTdDLE1BQU0sd0JBQXdCLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLEVBQUUsRUFBRTtZQUNyRSxNQUFNLFFBQVEsR0FBRyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDcEMsSUFBSSxPQUFPLFFBQVEsS0FBSyxVQUFVLElBQUksWUFBWSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7Z0JBQzNELE9BQU8sUUFBUSxDQUFDO1lBQ3BCLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILElBQUcsQ0FBQyx3QkFBd0IsRUFBQyxDQUFDO1lBQzFCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLCtCQUErQixJQUFJLDZCQUE2QixDQUFDLENBQUM7UUFDdkYsQ0FBQztRQUVELElBQUEsdUJBQVUsRUFBQztZQUNQLFNBQVMsRUFBRSxXQUFXLENBQUMsU0FBUyxJQUFJLEtBQUs7WUFDekMsY0FBYyxFQUFFLFdBQVcsQ0FBQyxjQUFjLElBQUksS0FBSztTQUN0RCxDQUFDLENBQUE7UUFDRixNQUFNLG9CQUFvQjtTQUFHO1FBRTdCLGlHQUFpRztRQUNqRyxNQUFNLGVBQWUsR0FBRyx3QkFBd0IsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQixDQUFDO1FBRWxILE1BQU0sU0FBUyxHQUFHLFlBQVksQ0FBQyxlQUFlLENBQUMsSUFBSSxZQUFZLENBQUM7UUFFaEUsb0VBQW9FO1FBQ3BFLE1BQU0scUJBQXFCLEdBQUcsb0JBQW9CLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDcEUsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUN2QyxTQUFTLEVBQ1QsV0FBVyxDQUFDLFlBQVksRUFDeEIscUJBQXFCLENBQ3hCLENBQUM7UUFFRiwrQkFBK0I7UUFDL0IsbUZBQW1GO1FBQ25GLHdFQUF3RTtRQUN4RSxNQUFNLFdBQVcsR0FBRyxXQUFXLENBQUMsV0FBVyxJQUFJLFlBQVksQ0FBQztRQUM1RCxNQUFNLG9CQUFvQixHQUFHLHVCQUF1QixXQUFXLEVBQUUsQ0FBQztRQUVsRSxNQUFNLFNBQVMsR0FBRyxJQUFBLGdCQUFRLEVBQUMsYUFBYSxFQUFFLFNBQVMsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBQzNFLE1BQU0sU0FBUyxHQUFHLElBQUEsZ0JBQVEsRUFBQyxhQUFhLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFFckQsa0VBQWtFO1FBQ2xFLGdFQUFnRTtRQUNoRSxrRUFBa0U7UUFDbEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxTQUFTLHFCQUFxQixDQUFDLENBQUM7UUFDckQsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBRWxDLGlDQUFpQztRQUNqQyxJQUFJLENBQUMsSUFBQSxvQkFBVSxFQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDekIsSUFBQSxtQkFBUyxFQUFDLFNBQVMsRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQzlDLENBQUM7UUFFRCxnRkFBZ0Y7UUFDaEYsTUFBTSxnQkFBZ0IsR0FBRyxDQUFDLFlBQVksQ0FBQyxRQUFRLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQ3RILElBQUksZ0JBQWdCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzlCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksU0FBUyw2Q0FBNkMsQ0FBQyxDQUFDO1lBQzdFLE1BQU0sb0NBQW9DLENBQUMsU0FBUyxFQUFFLGdCQUFnQixFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUN6RixDQUFDO1FBRUQsaURBQWlEO1FBQ2pELE1BQU0sVUFBVSxHQUFHLElBQUEsZ0JBQVEsRUFBQyxTQUFTLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFDbkQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxTQUFTLGtDQUFrQyxDQUFDLENBQUM7UUFDbEUsTUFBTSxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFLFlBQVksQ0FBQyxDQUFDO1FBRXhELE1BQU0sT0FBTyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsY0FBYyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2xFLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksU0FBUyx5QkFBeUIsT0FBTyxHQUFHLENBQUMsQ0FBQTtRQUVsRSwrREFBK0Q7UUFDL0QsdURBQXVEO1FBQ3ZELE1BQU0sZUFBZSxHQUFHLElBQUEsZ0JBQVEsRUFBQyxNQUFNLEVBQUUsb0JBQW9CLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFDM0UsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxTQUFTLHdCQUF3QixlQUFlLEVBQUUsQ0FBQyxDQUFDO1FBRXpFLElBQUksQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMsU0FBUyxFQUFFLGVBQWUsRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO1FBRWhGLElBQUcsYUFBYSxDQUFDLGVBQWUsQ0FBQyxFQUFDLENBQUM7WUFDL0IsNENBQTRDO1lBQzVDLElBQUksQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsU0FBUyxDQUFDLENBQUM7WUFFL0MsNEVBQTRFO1lBQzVFLElBQUksY0FBYyxDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUM7Z0JBQ3RDLG9GQUFvRjtnQkFDcEYsb0VBQW9FO2dCQUNwRSxJQUFJLFdBQVcsQ0FBQyxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7b0JBQ3JDLE1BQU0sSUFBSSxLQUFLLENBQUMsU0FBUyxTQUFTLDZDQUE2QyxDQUFDLENBQUM7Z0JBQ3JGLENBQUM7Z0JBQ0QsSUFBSSxDQUFDLElBQUksQ0FBQywyQkFBMkIsQ0FBQyx1QkFBdUIsU0FBUyxFQUFFLEVBQUUsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO2dCQUM1RixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLFNBQVMsNENBQTRDLFdBQVcsQ0FBQyxRQUFRLEdBQUcsQ0FBQyxDQUFDO1lBQ3ZHLENBQUM7aUJBQU0sQ0FBQztnQkFDSixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLFNBQVMsdUVBQXVFLENBQUMsQ0FBQztZQUMzRyxDQUFDO1FBQ0wsQ0FBQztRQUVELE1BQU0sVUFBVSxHQUFHLGFBQWEsQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUVsRCxNQUFNLGlCQUFpQixHQUFzQjtZQUN6QyxnQkFBZ0IsRUFBRSxTQUFTO1lBQzNCLGtCQUFrQixFQUFFLENBQUUsb0JBQU8sQ0FBQyxXQUFXLENBQUU7WUFDM0MsSUFBSSxFQUFFLGlCQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQztZQUMvQix1QkFBdUIsRUFBRSxDQUFDLHlCQUFZLENBQUMsTUFBTSxDQUFDO1NBQ2pELENBQUM7UUFFRixNQUFNLEtBQUssR0FBRyxJQUFJLHlCQUFZLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxTQUFTLEdBQUcsUUFBUSxFQUFFO1lBQ2pFLEdBQUcsaUJBQWlCO1lBQ3BCLEdBQUcsV0FBVyxDQUFDLFVBQVU7WUFDekIsR0FBRyxVQUFVLEVBQUUsb0RBQW9EO1NBQ3RFLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsc0JBQVUsQ0FBQyxLQUFLLEVBQUUsaUJBQWlCLENBQUMsQ0FBQztRQUUxRix3REFBd0Q7UUFDeEQsSUFBSSxXQUFXLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDN0IsZ0JBQWdCLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDaEMsQ0FBQztJQUNMLENBQUM7Q0FDSjtBQXZSRCx3Q0F1UkM7QUFyUGdCO0lBRFosSUFBQSxxQkFBVyxHQUFFOytDQXlCYjtBQStOTDs7OztHQUlHO0FBQ0gsU0FBUyxhQUFhLENBQUMsU0FBaUI7SUFDcEMsSUFBSSxLQUFLLEdBQWEsRUFBRSxDQUFDO0lBQ3pCLE1BQU0sS0FBSyxHQUFHLElBQUEscUJBQVcsRUFBQyxTQUFTLENBQUMsQ0FBQztJQUVyQyxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO1FBQ3ZCLE1BQU0sUUFBUSxHQUFHLElBQUEsZ0JBQVEsRUFBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDM0MsTUFBTSxJQUFJLEdBQUcsSUFBQSxrQkFBUSxFQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRWhDLElBQUksSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7WUFDckIsS0FBSyxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7UUFDbEQsQ0FBQzthQUFNLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLFFBQVEsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUNuRCxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ3pCLENBQUM7SUFDTCxDQUFDO0lBRUQsT0FBTyxLQUFLLENBQUM7QUFDakIsQ0FBQztBQUVELFNBQVMsWUFBWSxDQUFDLE1BQWdCO0lBQ2xDLE9BQU8sQ0FBQyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUNsQyxDQUFDO0FBRUQsU0FBUyxhQUFhLENBQUMsTUFBZ0I7SUFDbkMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLFdBQVcsQ0FBQyxDQUFDO0FBQzdDLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxNQUFnQjtJQUNwQyxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO0lBQ3BELG1DQUFtQztJQUNuQyxPQUFPLEtBQUssS0FBSyxLQUFLLENBQUM7QUFDM0IsQ0FBQztBQUVELFNBQVMsWUFBWSxDQUFDLE1BQWdCO0lBQ2xDLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsV0FBVyxDQUFDLENBQUM7QUFDNUMsQ0FBQztBQUVELFNBQVMsb0JBQW9CLENBQUMsTUFBZ0I7SUFDMUMsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxjQUFjLENBQUMsQ0FBQztBQUMvQyxDQUFDO0FBRUQsU0FBZ0IsYUFBYSxDQUFDLE1BQWdCO0lBQzFDLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsWUFBWSxDQUFDLENBQUM7QUFDN0MsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILEtBQUssVUFBVSxpQkFBaUIsQ0FBQyxTQUFpQixFQUFFLFVBQWtCLEVBQUUsWUFBMEI7SUFDOUYsTUFBTSxZQUFZLEdBQWlCO1FBQy9CLEdBQUcsWUFBWTtRQUNmLE9BQU8sRUFBRSxVQUFVO1FBQ25CLFdBQVcsRUFBRSxDQUFDLFNBQVMsQ0FBQztLQUMzQixDQUFDO0lBRUYsdUJBQWEsQ0FBQyxLQUFLLENBQUMsc0JBQXNCLFNBQVMsTUFBTSxVQUFVLEVBQUUsQ0FBQyxDQUFDO0lBRXZFLElBQUksQ0FBQztRQUNELE1BQU0sSUFBQSxlQUFLLEVBQUMsWUFBWSxDQUFDLENBQUM7SUFDOUIsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDYix1QkFBYSxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsU0FBUyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDN0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxzQkFBc0IsU0FBUyxLQUFLLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDbEgsQ0FBQztBQUNMLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsaUJBQWlCLENBQUMsUUFBZ0I7SUFDdkMsTUFBTSxPQUFPLEdBQUcsSUFBQSxzQkFBWSxFQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3ZDLE9BQU8sSUFBQSx3QkFBVSxFQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDOUQsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7R0FPRztBQUNILFNBQVMscUJBQXFCLENBQUMsT0FBZTtJQUMxQyxNQUFNLElBQUksR0FBRyxJQUFBLHdCQUFVLEVBQUMsUUFBUSxDQUFDLENBQUM7SUFDbEMsSUFBSSxTQUFTLEdBQUcsQ0FBQyxDQUFDO0lBRWxCLE1BQU0sZ0JBQWdCLEdBQUcsQ0FBQyxXQUFtQixFQUFFLEVBQUU7UUFDN0MsSUFBSSxDQUFDLElBQUEsb0JBQVUsRUFBQyxXQUFXLENBQUM7WUFBRSxPQUFPO1FBRXJDLE1BQU0sSUFBSSxHQUFHLElBQUEsbUJBQVMsRUFBQyxXQUFXLENBQUMsQ0FBQztRQUVwQyxJQUFJLElBQUksQ0FBQyxjQUFjLEVBQUUsRUFBRSxDQUFDO1lBQ3hCLGtFQUFrRTtZQUNsRSxPQUFPO1FBQ1gsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7WUFDckIsTUFBTSxLQUFLLEdBQUcsSUFBQSxxQkFBVyxFQUFDLFdBQVcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGlDQUFpQztZQUM1RyxLQUFJLE1BQU0sSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUN0QixvREFBb0Q7Z0JBQ3BELElBQUksSUFBSSxLQUFLLGNBQWMsSUFBSSxJQUFJLEtBQUssTUFBTTtvQkFDMUMsSUFBSSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssV0FBVztvQkFDdkMsSUFBSSxLQUFLLFVBQVUsSUFBSSxJQUFJLEtBQUssV0FBVyxFQUFFLENBQUM7b0JBQzlDLE9BQU87Z0JBQ1gsQ0FBQztnQkFDRCxnQkFBZ0IsQ0FBQyxJQUFBLGdCQUFRLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUM7WUFDbEQsQ0FBQztRQUNMLENBQUM7YUFBTSxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO1lBQ3ZCLFNBQVMsRUFBRSxDQUFDO1lBQ1osMkNBQTJDO1lBQzNDLE1BQU0sWUFBWSxHQUFHLElBQUEsb0JBQVksRUFBQyxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFDeEQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUMxQixxQkFBcUI7WUFDckIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFBLHNCQUFZLEVBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQztRQUMzQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDO0lBRUYsc0RBQXNEO0lBQ3RELElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDckIsZ0JBQWdCLENBQUMsT0FBTyxDQUFDLENBQUM7SUFFMUIsMERBQTBEO0lBQzFELDhFQUE4RTtJQUM5RSxJQUFJLFNBQVMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUNsQixJQUFJLENBQUMsTUFBTSxDQUFDLHFCQUFxQixDQUFDLENBQUM7SUFDdkMsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUM5QixDQUFDO0FBR0Q7OztHQUdHO0FBQ0gsU0FBUyxnQkFBZ0IsQ0FBQyxTQUFpQjtJQUN2QyxJQUFJLENBQUM7UUFDRCxJQUFBLGdCQUFNLEVBQUMsU0FBUyxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUNwRCx1QkFBYSxDQUFDLElBQUksQ0FBQyxzREFBc0QsU0FBUyxFQUFFLENBQUMsQ0FBQztJQUMxRixDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNiLHVCQUFhLENBQUMsS0FBSyxDQUFDLG1EQUFtRCxTQUFTLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUNoRyxDQUFDO0FBQ0wsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILEtBQUssVUFBVSxvQ0FBb0MsQ0FBQyxjQUFzQixFQUFFLGdCQUFxQyxFQUFFLE1BQVc7SUFDMUgsdUZBQXVGO0lBQ3ZGLE1BQU0sWUFBWSxHQUFHLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUMvQyxPQUFPLEdBQUcsS0FBSyxRQUFRO1FBQ3ZCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsSUFBUyw2QkFBNkI7UUFDakUsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxJQUFVLDZCQUE2QjtRQUNqRSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLElBQU0sa0JBQWtCO1FBQ3RELEdBQUcsS0FBSyxTQUFTLElBQW1CLGtCQUFrQjtRQUN0RCxHQUFHLEtBQUssa0JBQWtCLENBQVUsZ0RBQWdEO0tBQzNFLENBQUM7SUFFZCxJQUFJLFlBQVksQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDNUIsT0FBTztJQUNYLENBQUM7SUFFRCxNQUFNLFNBQVMsR0FBRyxJQUFBLGdCQUFRLEVBQUMsY0FBYyxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQ3JELE1BQU0sY0FBYyxHQUFHLElBQUEsZ0JBQVEsRUFBQyxTQUFTLEVBQUUsY0FBYyxDQUFDLENBQUM7SUFDM0QsTUFBTSxlQUFlLEdBQUcsSUFBQSxnQkFBUSxFQUFDLFNBQVMsRUFBRSxjQUFjLENBQUMsQ0FBQztJQUM1RCxNQUFNLGVBQWUsR0FBRyxJQUFBLGdCQUFRLEVBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFDO0lBRTdELDZCQUE2QjtJQUM3QixNQUFNLFdBQVcsR0FBUTtRQUNyQixJQUFJLEVBQUUsb0JBQW9CO1FBQzFCLE9BQU8sRUFBRSxPQUFPO1FBQ2hCLFlBQVksRUFBRSxFQUFFO0tBQ25CLENBQUM7SUFFRix5REFBeUQ7SUFDekQsTUFBTSxXQUFXLEdBQUcsSUFBQSxtQkFBVyxFQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQy9DLE1BQU0sc0JBQXNCLEdBQUcsSUFBQSxnQkFBUSxFQUFDLFdBQVcsRUFBRSxjQUFjLENBQUMsQ0FBQztJQUVyRSwwREFBMEQ7SUFDMUQsTUFBTSxrQkFBa0IsR0FBMkIsRUFBRSxDQUFDO0lBRXRELElBQUksQ0FBQyxJQUFBLG9CQUFVLEVBQUMsc0JBQXNCLENBQUMsRUFBRSxDQUFDO1FBQ3RDLE1BQU0sQ0FBQyxJQUFJLENBQUMsNkJBQTZCLHNCQUFzQiw4QkFBOEIsQ0FBQyxDQUFDO1FBQy9GLEtBQUksTUFBTSxHQUFHLElBQUksWUFBWSxFQUFFLENBQUM7WUFDNUIsV0FBVyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsR0FBRyxRQUFRLENBQUM7UUFDN0MsQ0FBQztJQUNMLENBQUM7U0FBTSxDQUFDO1FBQ0osTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUEsc0JBQVksRUFBQyxzQkFBc0IsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDO1FBQ3JGLDRGQUE0RjtRQUM1RixNQUFNLFdBQVcsR0FBRyxrQkFBa0IsQ0FBQyxZQUFZLElBQUksRUFBRSxDQUFDO1FBRTFELEtBQUksTUFBTSxHQUFHLElBQUksWUFBWSxFQUFFLENBQUM7WUFDNUIsSUFBSSxXQUFXLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDbkIsSUFBSSxRQUFRLEdBQUcsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUVoQyxtR0FBbUc7Z0JBQ25HLE1BQU0sVUFBVSxHQUFHLFFBQVEsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDO29CQUMzQixRQUFRLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQztvQkFDMUIsUUFBUSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUM7b0JBQ3pCLFFBQVEsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDO29CQUMzQixRQUFRLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUUvQyxJQUFJLFVBQVUsRUFBRSxDQUFDO29CQUNiLE1BQU0sU0FBUyxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO29CQUNoRCw2Q0FBNkM7b0JBQzdDLE1BQU0sWUFBWSxHQUFHLElBQUEsbUJBQVcsRUFBQyxXQUFXLEVBQUUsU0FBUyxDQUFDLENBQUM7b0JBRXpELGdDQUFnQztvQkFDaEMsSUFBSSxDQUFDLElBQUEsb0JBQVUsRUFBQyxZQUFZLENBQUMsRUFBRSxDQUFDO3dCQUM1QixNQUFNLFFBQVEsR0FBRzs0QkFDYixvQkFBb0IsR0FBRywwQkFBMEIsWUFBWSxFQUFFOzRCQUMvRCxvQ0FBb0MsUUFBUSxFQUFFOzRCQUM5QyxrQ0FBa0MsV0FBVyxFQUFFOzRCQUMvQyxxREFBcUQ7eUJBQ3hELENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO3dCQUNiLE1BQU0sQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUM7d0JBQ3ZCLE1BQU0sSUFBSSxLQUFLLENBQUMsaUNBQWlDLEdBQUcsT0FBTyxZQUFZLEVBQUUsQ0FBQyxDQUFDO29CQUMvRSxDQUFDO29CQUVELG1FQUFtRTtvQkFDbkUsTUFBTSxRQUFRLEdBQUcsSUFBQSxnQkFBUSxFQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsQ0FBQztvQkFDaEQsSUFBSSxDQUFDLElBQUEsb0JBQVUsRUFBQyxRQUFRLENBQUMsRUFBRSxDQUFDO3dCQUN4QixNQUFNLFFBQVEsR0FBRzs0QkFDYixvQkFBb0IsR0FBRyx5QkFBeUIsUUFBUSxFQUFFOzRCQUMxRCxvRUFBb0U7NEJBQ3BFLHVDQUF1QyxZQUFZLEVBQUU7NEJBQ3JELGtCQUFrQixZQUFZLG1CQUFtQjt5QkFDcEQsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7d0JBQ2IsTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQzt3QkFDdkIsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsR0FBRyx3QkFBd0IsQ0FBQyxDQUFDO29CQUM3RSxDQUFDO29CQUVELHFEQUFxRDtvQkFDckQsTUFBTSxDQUFDLElBQUksQ0FBQywrQkFBK0IsR0FBRyxrQkFBa0IsQ0FBQyxDQUFDO29CQUNsRSxNQUFNLFdBQVcsR0FBRyxxQkFBcUIsQ0FBQyxRQUFRLENBQUMsQ0FBQztvQkFFcEQsNERBQTREO29CQUM1RCxJQUFJLFdBQVcsRUFBRSxNQUFNLEtBQUssRUFBRSxFQUFFLENBQUM7d0JBQzdCLE1BQU0sQ0FBQyxJQUFJLENBQUMsK0JBQStCLEdBQUcsTUFBTSxXQUFXLEVBQUUsQ0FBQyxDQUFDO29CQUN2RSxDQUFDO29CQUVELGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxHQUFHLFdBQVcsQ0FBQztvQkFDdEMsTUFBTSxDQUFDLElBQUksQ0FBQyx1QkFBdUIsR0FBRyxXQUFXLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxRQUFRLEdBQUcsR0FBRyxDQUFDLENBQUM7b0JBRTdGLG1FQUFtRTtvQkFDbkUsTUFBTSxxQkFBcUIsR0FBRyxJQUFBLG9CQUFZLEVBQUMsU0FBUyxFQUFFLFlBQVksQ0FBQyxDQUFDO29CQUNwRSxRQUFRLEdBQUcscUJBQXFCLENBQUM7b0JBQ2pDLE1BQU0sQ0FBQyxJQUFJLENBQUMsZ0NBQWdDLEdBQUcsTUFBTSxxQkFBcUIsRUFBRSxDQUFDLENBQUM7Z0JBQ2xGLENBQUM7Z0JBRUQsV0FBVyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsR0FBRyxRQUFRLENBQUM7WUFDN0MsQ0FBQztpQkFBTSxDQUFDO2dCQUNKLG9FQUFvRTtnQkFDcEUsTUFBTSxRQUFRLEdBQUc7b0JBQ2IsY0FBYyxHQUFHLHNDQUFzQztvQkFDdkQscUdBQXFHO29CQUNyRyxXQUFXLEdBQUcsNERBQTREO29CQUMxRSwyQkFBMkIsR0FBRyxTQUFTO29CQUN2Qyw0QkFBNEI7aUJBQy9CLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUViLE1BQU0sQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUM7Z0JBQ3ZCLE1BQU0sSUFBSSxLQUFLLENBQUMsK0JBQStCLEdBQUcsRUFBRSxDQUFDLENBQUM7WUFDMUQsQ0FBQztRQUNMLENBQUM7UUFBQSxDQUFDO0lBQ04sQ0FBQztJQUVELE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxXQUFXLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDO0lBQ2hFLE1BQU0sSUFBSSxHQUFHLElBQUEsd0JBQVUsRUFBQyxRQUFRLENBQUMsQ0FBQztJQUNsQyxJQUFJLENBQUMsTUFBTSxDQUFDLGtCQUFrQixDQUFDLENBQUM7SUFFaEMsa0VBQWtFO0lBQ2xFLDRFQUE0RTtJQUM1RSxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDN0MsTUFBTSxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsTUFBTSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLE1BQU0sNENBQTRDLENBQUMsQ0FBQztRQUNuSCxLQUFJLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUNsRixJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsR0FBRyxJQUFJLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUNyRCxDQUFDO0lBQ0wsQ0FBQztJQUVELE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUU5QyxrRUFBa0U7SUFDbEUsOENBQThDO0lBQzlDLGtFQUFrRTtJQUNsRSxJQUFJLFVBQVUsR0FBa0IsSUFBSSxDQUFDO0lBQ3JDLElBQUksQ0FBQyxJQUFBLG9CQUFVLEVBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztRQUMvQixVQUFVLEdBQUcsMkNBQTJDLENBQUM7SUFDN0QsQ0FBQztTQUFNLElBQUksQ0FBQyxJQUFBLG9CQUFVLEVBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztRQUNyQyxVQUFVLEdBQUcsa0NBQWtDLENBQUM7SUFDcEQsQ0FBQztTQUFNLENBQUM7UUFDSixJQUFJLENBQUM7WUFDRCxNQUFNLFlBQVksR0FBRyxJQUFBLHNCQUFZLEVBQUMsZUFBZSxFQUFFLE9BQU8sQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ25FLGdEQUFnRDtZQUNoRCxJQUFJLFlBQVksQ0FBQyxNQUFNLEtBQUssRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUM7Z0JBQ3JFLFVBQVUsR0FBRywwQ0FBMEMsWUFBWSxDQUFDLE1BQU0sU0FBUyxDQUFDO1lBQ3hGLENBQUM7aUJBQU0sSUFBSSxZQUFZLEtBQUssa0JBQWtCLEVBQUUsQ0FBQztnQkFDN0MsTUFBTSxDQUFDLElBQUksQ0FBQyxnRUFBZ0UsQ0FBQyxDQUFDO2dCQUM5RSxPQUFPLENBQUMscUJBQXFCO1lBQ2pDLENBQUM7aUJBQU0sQ0FBQztnQkFDSixVQUFVLEdBQUcsNkJBQTZCLENBQUM7Z0JBQzNDLE1BQU0sQ0FBQyxJQUFJLENBQUMsdUJBQXVCLFlBQVksQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDdkUsTUFBTSxDQUFDLElBQUksQ0FBQyx1QkFBdUIsa0JBQWtCLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQzdFLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDN0MsTUFBTSxDQUFDLElBQUksQ0FBQyx5Q0FBeUMsTUFBTSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQ3ZHLENBQUM7WUFDTCxDQUFDO1FBQ0wsQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFDbEIsVUFBVSxHQUFHLDZCQUE2QixLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDOUQsQ0FBQztJQUNMLENBQUM7SUFFRCxrRUFBa0U7SUFDbEUscUNBQXFDO0lBQ3JDLGtFQUFrRTtJQUNsRSxNQUFNLENBQUMsSUFBSSxDQUFDLHNDQUFzQyxVQUFVLEdBQUcsQ0FBQyxDQUFDO0lBQ2pFLE1BQU0sQ0FBQyxJQUFJLENBQUMsbUJBQW1CLFlBQVksQ0FBQyxNQUFNLGdCQUFnQixZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUU3RixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUVwQywwQkFBMEI7SUFDMUIsSUFBSSxDQUFDLElBQUEsb0JBQVUsRUFBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ3pCLElBQUEsbUJBQVMsRUFBQyxTQUFTLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUM5QyxDQUFDO0lBRUQscUJBQXFCO0lBQ3JCLElBQUEsdUJBQWEsRUFBQyxlQUFlLEVBQUUsa0JBQWtCLENBQUMsQ0FBQztJQUVuRCx1QkFBdUI7SUFDdkIsSUFBSSxDQUFDO1FBQ0QsNEVBQTRFO1FBQzVFLDBEQUEwRDtRQUMxRCxtRUFBbUU7UUFDbkUsNERBQTREO1FBQzVELElBQUEsNkJBQVEsRUFBQywyRUFBMkUsRUFBRTtZQUNsRixHQUFHLEVBQUUsU0FBUztZQUNkLEtBQUssRUFBRSxTQUFTO1NBQ25CLENBQUMsQ0FBQztRQUVILE1BQU0sT0FBTyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsZ0JBQWdCLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDcEUsTUFBTSxDQUFDLElBQUksQ0FBQyxnQ0FBZ0MsT0FBTyxHQUFHLENBQUMsQ0FBQztRQUV4RCx5QkFBeUI7UUFDekIsSUFBQSx1QkFBYSxFQUFDLGVBQWUsRUFBRSxrQkFBa0IsQ0FBQyxDQUFDO0lBRXZELENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsTUFBTSxDQUFDLEtBQUssQ0FBQywwQ0FBMEMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNoRSxNQUFNLEtBQUssQ0FBQztJQUNoQixDQUFDO0FBQ0wsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxhQUFhLENBQUMsTUFBYyxFQUFFLE1BQWM7SUFDakQsSUFBSSxDQUFDLElBQUEsb0JBQVUsRUFBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1FBQ3RCLElBQUEsbUJBQVMsRUFBQyxNQUFNLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUMzQyxDQUFDO0lBQ0QsTUFBTSxLQUFLLEdBQUcsSUFBQSxxQkFBVyxFQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ2xDLEtBQUksTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7UUFDdEIsTUFBTSxVQUFVLEdBQUcsSUFBQSxnQkFBUSxFQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztRQUMxQyxNQUFNLFVBQVUsR0FBRyxJQUFBLGdCQUFRLEVBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzFDLElBQUksSUFBQSxtQkFBUyxFQUFDLFVBQVUsQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7WUFDdEMsYUFBYSxDQUFDLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUMxQyxDQUFDO2FBQU0sQ0FBQztZQUNKLElBQUEsc0JBQVksRUFBQyxVQUFVLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFDekMsQ0FBQztJQUNMLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcblxuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmUvaGVscGVyXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgRGVmYXVsdExvZ2dlciwgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciwgSUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBBcmNoaXRlY3R1cmUsIENvZGUsIExheWVyVmVyc2lvbiwgTGF5ZXJWZXJzaW9uUHJvcHMsIFJ1bnRpbWUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IGJhc2VuYW1lIGFzIHBhdGhCYXNlTmFtZSwgcmVzb2x2ZSBhcyBwYXRoUmVzb2x2ZSwgam9pbiBhcyBwYXRoSm9pbiwgZXh0bmFtZSBhcyBwYXRoRXh0bmFtZSwgcmVsYXRpdmUgYXMgcGF0aFJlbGF0aXZlIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGV4aXN0c1N5bmMsIG1rZGlyU3luYywgcmVhZGRpclN5bmMsIHN0YXRTeW5jLCBybVN5bmMsIGxzdGF0U3luYywgY29weUZpbGVTeW5jLCByZWFkRmlsZVN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tICdub2RlOmZzJztcbmltcG9ydCB7IGV4ZWNTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGJ1aWxkLCBCdWlsZE9wdGlvbnMgfSBmcm9tICdlc2J1aWxkJztcbmltcG9ydCB7IExheWVyRW50cnkgfSBmcm9tIFwiLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwibm9kZTpjcnlwdG9cIjtcbmltcG9ydCB7IG1lcmdlIH0gZnJvbSBcIi4uL3V0aWxzL21lcmdlXCI7XG5cblxuLyoqXG4gKiBDb21tb24gbGF5ZXIgY29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzXG4gKi9cbmludGVyZmFjZSBJQmFzZUxheWVyQ29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIHNvdXJjZSBwYXRoIG9mIHRoZSBsYXllciBkaXJlY3Rvcnkgb3IgZmlsZS5cbiAgICAgKi9cbiAgICBzb3VyY2VQYXRoOiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBwcm9wZXJ0aWVzIGZvciB0aGUgbGF5ZXIgdmVyc2lvbi5cbiAgICAgKi9cbiAgICBsYXllclByb3BzPzogT21pdDxMYXllclZlcnNpb25Qcm9wcywgJ2NvZGUnPjtcblxuICAgIC8qKlxuICAgICAqIEN1c3RvbSBidWlsZCBvcHRpb25zIGZvciBlc2J1aWxkIGJ1bmRsaW5nLlxuICAgICAqIE1lcmdlZCBpbiBwcmlvcml0eSBvcmRlcjogZGVmYXVsdHMgPCBjb25zdHJ1Y3QtbGV2ZWwgPCBkZWNvcmF0b3ItbGV2ZWxcbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHtcbiAgICAgKiAgIGJ1aWxkT3B0aW9uczoge1xuICAgICAqICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICogICAgIG1pbmlmeTogZmFsc2UsXG4gICAgICogICAgIGV4dGVybmFsOiBbJ0Bhd3Mtc2RrJywgJ3NvbWUtbmF0aXZlLW1vZHVsZSddXG4gICAgICogICB9XG4gICAgICogfVxuICAgICAqL1xuICAgIGJ1aWxkT3B0aW9ucz86IEJ1aWxkT3B0aW9ucztcblxuICAgIC8qKlxuICAgICAqIFdoZXRoZXIgdGhpcyBsYXllciBzaG91bGQgTk9UIGJlIGFkZGVkIGFzIGEgZ2xvYmFsIGxheWVyLlxuICAgICAqIElmIGZhbHNlIG9yIHVuZGVmaW5lZCwgdGhlIGxheWVyIHdpbGwgYmUgYXV0b21hdGljYWxseSBhdHRhY2hlZCB0byBhbGwgTGFtYmRhIGZ1bmN0aW9ucy5cbiAgICAgKiBEZWZhdWx0cyB0byBmYWxzZSAobGF5ZXIgSVMgZ2xvYmFsKS5cbiAgICAgKi9cbiAgICBub3RHbG9iYWw/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogV2hldGhlciB0aGlzIGxheWVyIHNob3VsZCBiZSBsb2FkZWQgYXMgYW4gZW50cnkgcGFja2FnZSAoY29kZSBleGVjdXRlcyBhdCBtb2R1bGUgaW5pdGlhbGl6YXRpb24pLlxuICAgICAqIElmIGZhbHNlLCB0aGUgbGF5ZXIgaXMgb25seSBhdmFpbGFibGUgZm9yIGltcG9ydHMgYnV0IGRvZXNuJ3QgZXhlY3V0ZS5cbiAgICAgKiBEZWZhdWx0cyB0byBmYWxzZS5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIC8vIGZ3MjQgcnVudGltZSBsYXllciAtIGF2YWlsYWJsZSBmb3IgaW1wb3J0IGJ1dCBkb2Vzbid0IGV4ZWN1dGVcbiAgICAgKiB7IHNvdXJjZVBhdGg6ICcuL2Z3MjQuanMnLCBpc0VudHJ5UGFja2FnZTogZmFsc2UgfVxuICAgICAqIFxuICAgICAqIC8vIGRpIGxheWVyIC0gZXhlY3V0ZXMgRElDb250YWluZXIuUk9PVC5tb2R1bGUoKSBhdCBpbml0XG4gICAgICogeyBzb3VyY2VQYXRoOiAnLi9kaS50cycsIGlzRW50cnlQYWNrYWdlOiB0cnVlIH1cbiAgICAgKi9cbiAgICBpc0VudHJ5UGFja2FnZT86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBQcmlvcml0eSBmb3IgbGF5ZXIgbG9hZGluZyBvcmRlci4gTG93ZXIgbnVtYmVycyBsb2FkIGZpcnN0LlxuICAgICAqIElmIG5vdCBzcGVjaWZpZWQsIHByaW9yaXR5IGlzIGF1dG8tYXNzaWduZWQgYXMgKGFycmF5X2luZGV4ICsgMTApLlxuICAgICAqIFxuICAgICAqIFByaW9yaXR5IHJhbmdlczpcbiAgICAgKiAtIDAtOTogUmVzZXJ2ZWQgZm9yIGZyYW1ld29yayBsYXllcnMgKGZ3MjQgY29yZSA9IDApXG4gICAgICogLSAxMCs6IFVzZXIvYXBwbGljYXRpb24gbGF5ZXJzIChhdXRvLWFzc2lnbmVkIG9yIGV4cGxpY2l0KVxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogLy8gQXV0by1hc3NpZ25lZCBwcmlvcml0aWVzIChyZWNvbW1lbmRlZCk6XG4gICAgICogY29uc3QgbGF5ZXJzID0gbmV3IExheWVyQ29uc3RydWN0KFtcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vZGkudHMnIH0sICAgICAgICAvLyBwcmlvcml0eTogMTBcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vc2hhcmVkLnRzJyB9LCAgICAvLyBwcmlvcml0eTogMTFcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vZmlyZWJhc2UudHMnIH0gICAvLyBwcmlvcml0eTogMTJcbiAgICAgKiBdKTtcbiAgICAgKiBcbiAgICAgKiAvLyBFeHBsaWNpdCBwcmlvcml0aWVzIChmb3Igc3BlY2lhbCBjYXNlcyk6XG4gICAgICogY29uc3QgbGF5ZXJzID0gbmV3IExheWVyQ29uc3RydWN0KFtcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vZGkudHMnLCBwcmlvcml0eTogMTAgfSwgICAgICAvLyBMb2FkIGZpcnN0XG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2ZpcmViYXNlLnRzJywgcHJpb3JpdHk6IDIwIH0sIC8vIExvYWQgbGFzdFxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9zaGFyZWQudHMnLCBwcmlvcml0eTogMTUgfSAgIC8vIExvYWQgaW4gYmV0d2VlblxuICAgICAqIF0pO1xuICAgICAqL1xuICAgIHByaW9yaXR5PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIHRoZSBQQUNLQUdFX0RJUkVDVE9SWSBtb2RlLlxuICogUGFja2FnZXMgYSBwcmUtYnVpbHQgZGlyZWN0b3J5IGFzLWlzIHdpdGhvdXQgYnVuZGxpbmcuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVBhY2thZ2VEaXJlY3RvcnlDb25maWcgZXh0ZW5kcyBJQmFzZUxheWVyQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgbmFtZSBvZiB0aGUgbGF5ZXIuXG4gICAgICovXG4gICAgbGF5ZXJOYW1lOiBzdHJpbmc7XG4gICAgXG4gICAgLyoqXG4gICAgICogVGhlIG1vZGUgb2YgcGFja2FnaW5nOiBwYWNrYWdlIHRoZSB3aG9sZSBkaXJlY3RvcnkuXG4gICAgICovXG4gICAgbW9kZT86ICdQQUNLQUdFX0RJUkVDVE9SWSc7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIEJVSUxEX0FORF9QQUNLQUdFIG1vZGUuXG4gKiBCdW5kbGVzIHNvdXJjZSBmaWxlcyB3aXRoIGVzYnVpbGQgYmVmb3JlIHBhY2thZ2luZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnIGV4dGVuZHMgSUJhc2VMYXllckNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIG1vZGUgb2YgcGFja2FnaW5nOiBzY2FuIGFuZCBidWlsZCBpbmRpdmlkdWFsIGZpbGVzLlxuICAgICAqL1xuICAgIG1vZGU6ICdCVUlMRF9BTkRfUEFDS0FHRSc7XG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBjdXN0b20gZGlzdHJpYnV0aW9uIGRpcmVjdG9yeSBmb3IgdGhlIGJ1aWxkIG91dHB1dHMuXG4gICAgICovXG4gICAgZGlzdERpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIEZsYWcgdG8gY2xlYXIgdGhlIG91dHB1dCBkaXJlY3RvcnkgYWZ0ZXIgcGFja2FnaW5nOyBkZWZhdWx0cyB0byBmYWxzZS5cbiAgICAgKi9cbiAgICBjbGVhck91dHB1dERpcj86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBDb25maWd1cmFibGUgb3V0cHV0IHBhdGggZm9yIHRoZSBwYWNrYWdlLlxuICAgICAqLyBcbiAgICBwYWNrYWdlUGF0aD86IHN0cmluZztcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBsYXllciBjb25zdHJ1Y3QuXG4gKiBcbiAqIExheWVycyBhcmUgcHJvY2Vzc2VkIGluIHBhcmFsbGVsIGZvciBzcGVlZCwgYnV0IGxvYWRlZCBhdCBydW50aW1lIGluIHByaW9yaXR5IG9yZGVyLlxuICogUHJpb3JpdHkgZGV0ZXJtaW5lcyB0aGUgb3JkZXIgaW4gd2hpY2ggbGF5ZXJzIGluaXRpYWxpemUgd2hlbiBMYW1iZGEgY29sZCBzdGFydHMuXG4gKiBcbiAqIEBzZWUgSUJ1aWxkQW5kUGFja2FnZUNvbmZpZy5wcmlvcml0eSBmb3IgcHJpb3JpdHkgZGV0YWlsc1xuICovXG5leHBvcnQgdHlwZSBJTGF5ZXJDb25zdHJ1Y3RDb25maWcgPSBJUGFja2FnZURpcmVjdG9yeUNvbmZpZyB8IElCdWlsZEFuZFBhY2thZ2VDb25maWc7XG5cbi8qKlxuICogUmVwcmVzZW50cyBhIGNvbnN0cnVjdCBmb3IgY3JlYXRpbmcgTGFtYmRhIGxheWVycy5cbiAqIFxuICogTGF5ZXJzIGFyZSBidWlsdCBpbiBwYXJhbGxlbCBmb3IgcGVyZm9ybWFuY2UsIGJ1dCBpbml0aWFsaXplIGF0IExhbWJkYSBydW50aW1lXG4gKiBpbiBwcmlvcml0eSBvcmRlci4gVGhpcyBlbnN1cmVzIGNvcnJlY3QgZGVwZW5kZW5jeSBsb2FkaW5nIChlLmcuLCBESSBjb250YWluZXJcbiAqIGxvYWRzIGJlZm9yZSBsYXllcnMgdGhhdCB1c2UgaXQpLlxuICogXG4gKiBQcmlvcml0eSBTeXN0ZW06XG4gKiAtIDAtOTogUmVzZXJ2ZWQgZm9yIGZyYW1ld29yayBsYXllcnMgKGZ3MjQgY29yZSA9IDApXG4gKiAtIDEwKzogQXBwbGljYXRpb24gbGF5ZXJzIChhdXRvLWFzc2lnbmVkIHN0YXJ0aW5nIGF0IDEwLCBvciBzZXQgZXhwbGljaXRseSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiAvLyBCYXNpYyB1c2FnZSB3aXRoIGF1dG8tcHJpb3JpdHkgKHJlY29tbWVuZGVkKVxuICogY29uc3QgZGlMYXllciA9IG5ldyBESUxheWVyQ29uc3RydWN0KFtcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvZGkudHMnIH0sICAgICAgICAgICAgICAvLyBwcmlvcml0eTogMTAgKGF1dG8pXG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2NvbmZpZy9zaGFyZWQudHMnIH0sICAgLy8gcHJpb3JpdHk6IDExIChhdXRvKVxuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9jb25maWcvZmlyZWJhc2UudHMnIH0gIC8vIHByaW9yaXR5OiAxMiAoYXV0bylcbiAqIF0pO1xuICogXG4gKiAvLyBBZHZhbmNlZCB1c2FnZSB3aXRoIGV4cGxpY2l0IHByaW9yaXRpZXNcbiAqIGNvbnN0IGRpTGF5ZXIgPSBuZXcgRElMYXllckNvbnN0cnVjdChbXG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2RpLnRzJywgcHJpb3JpdHk6IDEwIH0sICAgICAgICAvLyBMb2FkIGZpcnN0XG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2NvbmZpZy9maXJlYmFzZS50cycsIHByaW9yaXR5OiAyMCB9LCAvLyBMb2FkIGxhc3RcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvY29uZmlnL3NoYXJlZC50cycsIHByaW9yaXR5OiAxNSB9ICAgIC8vIExvYWQgaW4gYmV0d2VlblxuICogXSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIExheWVyQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyOiBJTG9nZ2VyO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgXG4gICAgbmFtZSA9IExheWVyQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgTGF5ZXJDb25zdHJ1Y3QgaW5zdGFuY2UuXG4gICAgICogQHBhcmFtIGNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgTGF5ZXJDb25zdHJ1Y3QuXG4gICAgICovXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBjb25maWc6IElMYXllckNvbnN0cnVjdENvbmZpZ1tdLCB2ZXJib3NlTG9nID86IG51bWJlcikge1xuXG4gICAgICAgIGlmKHZlcmJvc2VMb2cpe1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIgPSBjcmVhdGVMb2dnZXIoTGF5ZXJDb25zdHJ1Y3QubmFtZSwgMSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihMYXllckNvbnN0cnVjdC5uYW1lKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gYWRkIGRlZmF1bHRzXG4gICAgICAgIGZvcihjb25zdCBsYXllckNvbmZpZyBvZiBjb25maWcpIHtcbiAgICAgICAgICAgIGxheWVyQ29uZmlnLm1vZGUgPSBsYXllckNvbmZpZy5tb2RlIHx8ICdQQUNLQUdFX0RJUkVDVE9SWSc7XG4gICAgICAgICAgICBpZiAobGF5ZXJDb25maWcubW9kZSA9PT0gJ0JVSUxEX0FORF9QQUNLQUdFJykge1xuICAgICAgICAgICAgICAgIGxheWVyQ29uZmlnLmNsZWFyT3V0cHV0RGlyID0gbGF5ZXJDb25maWcuY2xlYXJPdXRwdXREaXIgPz8gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhjb25maWcsICdMQVlFUicpO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgLy8gQXNzaWduIHByaW9yaXR5IHRvIGVhY2ggbGF5ZXI6IHVzZSBleHBsaWNpdCBwcmlvcml0eSBpZiBzZXQsIG90aGVyd2lzZSB1c2UgYXJyYXkgaW5kZXggKyAxMFxuICAgICAgICAvLyBQcmlvcml0eSAwLTkgcmVzZXJ2ZWQgZm9yIGZyYW1ld29yayBsYXllcnMgKGZ3MjQgY29yZSA9IDApXG4gICAgICAgIC8vIFVzZXIgbGF5ZXJzIHN0YXJ0IGF0IDEwKyB0byBlbnN1cmUgZnJhbWV3b3JrIGxheWVycyBhbHdheXMgbG9hZCBmaXJzdFxuICAgICAgICBmb3IoY29uc3QgW2luZGV4LCBsYXllckNvbmZpZ10gb2YgdGhpcy5jb25maWcuZW50cmllcygpKSB7XG4gICAgICAgICAgICBpZiAoIWxheWVyQ29uZmlnLnByaW9yaXR5ICYmIGxheWVyQ29uZmlnLnByaW9yaXR5ICE9PSAwKSB7XG4gICAgICAgICAgICAgICAgbGF5ZXJDb25maWcucHJpb3JpdHkgPSBpbmRleCArIDEwO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gUHJvY2VzcyBsYXllcnMgaW4gcGFyYWxsZWwgZm9yIHNwZWVkIHdoaWxlIHJlc3BlY3RpbmcgcHJpb3JpdHktYmFzZWQgbG9hZGluZyBvcmRlclxuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbCh0aGlzLmNvbmZpZy5tYXAoYXN5bmMgKGxheWVyQ29uZmlnKSA9PiB7XG4gICAgICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayhsYXllckNvbmZpZy5zdGFja05hbWUgfHwgdGhpcy5mdzI0LmdldENvbmZpZygpLmxheWVyU3RhY2tOYW1lLCBsYXllckNvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlByb2Nlc3NpbmcgbGF5ZXI6XCIsIGxheWVyQ29uZmlnKTtcblxuICAgICAgICAgICAgaWYgKGxheWVyQ29uZmlnLm1vZGUgPT09ICdQQUNLQUdFX0RJUkVDVE9SWScpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBhY2thZ2VEaXJlY3RvcnkobGF5ZXJDb25maWcpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllckNvbmZpZy5tb2RlID09PSAnQlVJTERfQU5EX1BBQ0tBR0UnKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zY2FuQW5kUGFja2FnZUZpbGVzKGxheWVyQ29uZmlnKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIG1vZGUgZm9yIGxheWVyICR7SlNPTi5zdHJpbmdpZnkobGF5ZXJDb25maWcpfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGFja2FnZXMgYSBkaXJlY3RvcnkgYXMgYSBMYW1iZGEgbGF5ZXIuXG4gICAgICogQHBhcmFtIGxheWVyQ29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBsYXllci5cbiAgICAgKiBAcGFyYW0gbWFpblN0YWNrIC0gVGhlIG1haW4gc3RhY2sgZm9yIGRlcGxveWluZyByZXNvdXJjZXMuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBwYWNrYWdlRGlyZWN0b3J5KGxheWVyQ29uZmlnOiBJUGFja2FnZURpcmVjdG9yeUNvbmZpZykge1xuICAgICAgICBjb25zdCBkZWZhdWx0TGF5ZXJQcm9wczogTGF5ZXJWZXJzaW9uUHJvcHMgPSB7XG4gICAgICAgICAgICBsYXllclZlcnNpb25OYW1lOiBsYXllckNvbmZpZy5sYXllck5hbWUsXG4gICAgICAgICAgICBjb21wYXRpYmxlUnVudGltZXM6IFsgUnVudGltZS5OT0RFSlNfMjJfWCBdLFxuICAgICAgICAgICAgY29kZTogQ29kZS5mcm9tQXNzZXQobGF5ZXJDb25maWcuc291cmNlUGF0aCksXG4gICAgICAgICAgICBjb21wYXRpYmxlQXJjaGl0ZWN0dXJlczogW0FyY2hpdGVjdHVyZS5BUk1fNjRdLFxuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgY29uc3QgbGF5ZXIgPSBuZXcgTGF5ZXJWZXJzaW9uKHRoaXMubWFpblN0YWNrLCBsYXllckNvbmZpZy5sYXllck5hbWUgKyAnLWxheWVyJywge1xuICAgICAgICAgICAgLi4uZGVmYXVsdExheWVyUHJvcHMsXG4gICAgICAgICAgICAuLi5sYXllckNvbmZpZy5sYXllclByb3BzLFxuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgbGF5ZXJDb25maWcubGF5ZXJOYW1lLCBsYXllciwgT3V0cHV0VHlwZS5MQVlFUiwgJ2xheWVyVmVyc2lvbkFybicpO1xuXG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBTY2FucyBhIGRpcmVjdG9yeSBmb3IgVHlwZVNjcmlwdCBmaWxlcyBhbmQgY3JlYXRlcyBMYW1iZGEgbGF5ZXJzIGZvciB0aGVtLlxuICAgICAqIEBwYXJhbSBsYXllckNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgbGF5ZXIuXG4gICAgICogQHBhcmFtIG1haW5TdGFjayAtIFRoZSBtYWluIHN0YWNrIGZvciBkZXBsb3lpbmcgcmVzb3VyY2VzLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgc2NhbkFuZFBhY2thZ2VGaWxlcyhsYXllckNvbmZpZzogSUJ1aWxkQW5kUGFja2FnZUNvbmZpZykge1xuICAgICAgICAvLyBEZWZhdWx0IHRvIGFwcGxpY2F0aW9uJ3MgZGlzdC9sYXllcnMgZGlyZWN0b3J5IChwcm9jZXNzLmN3ZCgpIGlzIHRoZSBhcHBsaWNhdGlvbiByb290KVxuICAgICAgICBjb25zdCBkaXN0RGlyZWN0b3J5ID0gbGF5ZXJDb25maWcuZGlzdERpcmVjdG9yeSB8fCBwYXRoSm9pbihwcm9jZXNzLmN3ZCgpLCAnZGlzdC9sYXllcnMnKTtcbiAgICAgICAgY29uc3Qgc291cmNlRGlyZWN0b3J5T3JGaWxlTmFtZSA9IHBhdGhSZXNvbHZlKGxheWVyQ29uZmlnLnNvdXJjZVBhdGgpO1xuICAgICAgICBjb25zdCB0c0ZpbGVzID0gbHN0YXRTeW5jKHNvdXJjZURpcmVjdG9yeU9yRmlsZU5hbWUpLmlzRGlyZWN0b3J5KClcbiAgICAgICAgICAgID8gc2NhbkRpcmVjdG9yeShzb3VyY2VEaXJlY3RvcnlPckZpbGVOYW1lKVxuICAgICAgICAgICAgOiBbc291cmNlRGlyZWN0b3J5T3JGaWxlTmFtZV07XG5cbiAgICAgICAgLy8gUHJvY2VzcyBmaWxlcyBpbiBwYXJhbGxlbCBub3cgdGhhdCB3ZSBoYXZlIHByaW9yaXR5LWJhc2VkIG9yZGVyaW5nXG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHRzRmlsZXMubWFwKGFzeW5jIChmaWxlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnRyeUNyZWF0ZUxheWVyRm9yRmlsZShmaWxlLCBkaXN0RGlyZWN0b3J5LCBsYXllckNvbmZpZyk7XG4gICAgICAgIH0pKTtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIE1lcmdlcyBidWlsZCBvcHRpb25zIHdpdGggcHJvcGVyIHByaW9yaXR5OiBkZWZhdWx0cyA8IGNvbnN0cnVjdC1sZXZlbCA8IGRlY29yYXRvci1sZXZlbFxuICAgICAqIEBwYXJhbSBsYXllck5hbWUgLSBMYXllciBuYW1lIGZvciBsb2dnaW5nXG4gICAgICogQHBhcmFtIGNvbnN0cnVjdEJ1aWxkT3B0aW9ucyAtIEJ1aWxkIG9wdGlvbnMgZnJvbSBjb25zdHJ1Y3QgY29uZmlnXG4gICAgICogQHBhcmFtIGRlY29yYXRvckJ1aWxkT3B0aW9ucyAtIEJ1aWxkIG9wdGlvbnMgZnJvbSBATGF5ZXJFbnRyeSBkZWNvcmF0b3JcbiAgICAgKiBAcmV0dXJucyBNZXJnZWQgYnVpbGQgb3B0aW9uc1xuICAgICAqL1xuICAgIHByaXZhdGUgbWVyZ2VCdWlsZE9wdGlvbnMoXG4gICAgICAgIGxheWVyTmFtZTogc3RyaW5nLFxuICAgICAgICBjb25zdHJ1Y3RCdWlsZE9wdGlvbnM/OiBCdWlsZE9wdGlvbnMsXG4gICAgICAgIGRlY29yYXRvckJ1aWxkT3B0aW9ucz86IEJ1aWxkT3B0aW9uc1xuICAgICk6IEJ1aWxkT3B0aW9ucyB7XG4gICAgICAgIC8vIERlZmF1bHQgYnVpbGQgb3B0aW9ucyBmb3IgYWxsIGxheWVyc1xuICAgICAgICBjb25zdCBkZWZhdWx0QnVpbGRPcHRpb25zOiBCdWlsZE9wdGlvbnMgPSB7XG4gICAgICAgICAgICBidW5kbGU6IHRydWUsXG4gICAgICAgICAgICBwbGF0Zm9ybTogJ25vZGUnLFxuICAgICAgICAgICAgdGFyZ2V0OiAnbm9kZTE4JyxcbiAgICAgICAgICAgIG1pbmlmeTogZmFsc2UsXG4gICAgICAgICAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgICAgICAgICAgZXh0ZXJuYWw6IFtcbiAgICAgICAgICAgICAgICAvLyBGcmFtZXdvcmsgcnVudGltZSBwcm92aWRlZCBieSBzZXBhcmF0ZSBmdzI0IGxheWVyXG4gICAgICAgICAgICAgICAgJ0B0ZW4yNGdyb3VwL2Z3MjQnLFxuICAgICAgICAgICAgICAgIC8vIEFXUyBTREsgYW5kIGJ1aWxkIHRvb2xzXG4gICAgICAgICAgICAgICAgJ0Bhd3Mtc2RrJyxcbiAgICAgICAgICAgICAgICAnQHNtaXRoeScsXG4gICAgICAgICAgICAgICAgJ2F3cy1jZGstbGliJyxcbiAgICAgICAgICAgICAgICAnZXNidWlsZCcsXG4gICAgICAgICAgICBdXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gTWVyZ2UgaW4gcHJpb3JpdHkgb3JkZXIgdXNpbmcgZGVlcCBtZXJnZVxuICAgICAgICBjb25zdCBtZXJnZWQgPSAobWVyZ2UoW1xuICAgICAgICAgICAgZGVmYXVsdEJ1aWxkT3B0aW9ucyxcbiAgICAgICAgICAgIGNvbnN0cnVjdEJ1aWxkT3B0aW9ucyB8fCB7fSxcbiAgICAgICAgICAgIGRlY29yYXRvckJ1aWxkT3B0aW9ucyB8fCB7fVxuICAgICAgICBdKSA/PyBkZWZhdWx0QnVpbGRPcHRpb25zKTtcblxuICAgICAgICAvLyBMb2cgbWVyZ2VkIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFske2xheWVyTmFtZX1dIEJ1aWxkIG9wdGlvbnMgbWVyZ2VkOmAsIHtcbiAgICAgICAgICAgIHNvdXJjZW1hcDogbWVyZ2VkLnNvdXJjZW1hcCxcbiAgICAgICAgICAgIG1pbmlmeTogbWVyZ2VkLm1pbmlmeSxcbiAgICAgICAgICAgIGV4dGVybmFsOiBtZXJnZWQuZXh0ZXJuYWwsXG4gICAgICAgICAgICBwbGF0Zm9ybTogbWVyZ2VkLnBsYXRmb3JtLFxuICAgICAgICAgICAgdGFyZ2V0OiBtZXJnZWQudGFyZ2V0XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBtZXJnZWQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQXR0ZW1wdHMgdG8gY3JlYXRlIGEgTGFtYmRhIGxheWVyIGZvciBhIGdpdmVuIFR5cGVTY3JpcHQgZmlsZS5cbiAgICAgKiBAcGFyYW0gZmlsZSAtIFRoZSBwYXRoIHRvIHRoZSBUeXBlU2NyaXB0IGZpbGUuXG4gICAgICogQHBhcmFtIGRpc3REaXJlY3RvcnkgLSBUaGUgb3V0cHV0IGRpcmVjdG9yeSBmb3IgdGhlIGJ1aWxkLlxuICAgICAqIEBwYXJhbSBtYWluU3RhY2sgLSBUaGUgbWFpbiBzdGFjayBmb3IgZGVwbG95aW5nIHJlc291cmNlcy5cbiAgICAgKiBAcGFyYW0gbGF5ZXJDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIGxheWVyLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgdHJ5Q3JlYXRlTGF5ZXJGb3JGaWxlKGZpbGU6IHN0cmluZywgZGlzdERpcmVjdG9yeTogc3RyaW5nLCBsYXllckNvbmZpZzogSUJ1aWxkQW5kUGFja2FnZUNvbmZpZykge1xuICAgICAgICBjb25zdCBmaWxlQmFzZU5hbWUgPSBwYXRoQmFzZU5hbWUoZmlsZSwgcGF0aEV4dG5hbWUoZmlsZSkpO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBQcm9jZXNzaW5nIGxheWVyOiAke2ZpbGVCYXNlTmFtZX1gKTtcbiAgICAgICAgXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBMb2FkaW5nIGxheWVyIGRlc2NyaXB0b3IgZnJvbSAke2ZpbGV9Li4uYCk7XG4gICAgICAgIGNvbnN0IG1vZHVsZUV4cG9ydHMgPSBhd2FpdCBpbXBvcnQoZmlsZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBMYXllciBkZXNjcmlwdG9yIGxvYWRlZGApO1xuXG4gICAgICAgIGNvbnN0IGZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSA9IE9iamVjdC5rZXlzKG1vZHVsZUV4cG9ydHMpLmZpbmQoKGtleSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZXhwb3J0ZWQgPSBtb2R1bGVFeHBvcnRzW2tleV07XG4gICAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydGVkID09PSAnZnVuY3Rpb24nICYmIGlzTGF5ZXJFbnRyeShleHBvcnRlZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhwb3J0ZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICBcbiAgICAgICAgaWYoIWZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSl7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBMYXllckVudHJ5IGZvdW5kIGluIGZpbGUgJHtmaWxlfS4gV2lsbCB1c2UgRGVmYXVsdCBvcHRpb25zLmApO1xuICAgICAgICB9XG5cbiAgICAgICAgTGF5ZXJFbnRyeSh7IFxuICAgICAgICAgICAgbm90R2xvYmFsOiBsYXllckNvbmZpZy5ub3RHbG9iYWwgPz8gZmFsc2UsXG4gICAgICAgICAgICBpc0VudHJ5UGFja2FnZTogbGF5ZXJDb25maWcuaXNFbnRyeVBhY2thZ2UgPz8gZmFsc2VcbiAgICAgICAgfSlcbiAgICAgICAgY2xhc3MgRW1wdHlMYXllckRlc2NyaXB0b3Ige31cblxuICAgICAgICAvLyBpZiBubyBsYXllciBkZXNjcmlwdG9yIGZvdW5kIGluIHRoZSBmaWxlLCBjcmVhdGUgYW4gZW1wdHkgY2xhc3Mgd2hpY2ggd2lsbCB1c2UgZGVmYXVsdCBvcHRpb25zXG4gICAgICAgIGNvbnN0IGxheWVyRGVzY3JpcHRvciA9IGZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSA/IG1vZHVsZUV4cG9ydHNbZm91bmRMYXllckRlc2NyaXB0b3JOYW1lXSA6IEVtcHR5TGF5ZXJEZXNjcmlwdG9yO1xuXG4gICAgICAgIGNvbnN0IGxheWVyTmFtZSA9IGdldExheWVyTmFtZShsYXllckRlc2NyaXB0b3IpIHx8IGZpbGVCYXNlTmFtZTtcbiAgICAgICAgXG4gICAgICAgIC8vIE1lcmdlIGJ1aWxkIG9wdGlvbnM6IGRlZmF1bHRzIDwgY29uc3RydWN0LWxldmVsIDwgZGVjb3JhdG9yLWxldmVsXG4gICAgICAgIGNvbnN0IGRlY29yYXRvckJ1aWxkT3B0aW9ucyA9IGdldExheWVyQnVpbGRPcHRpb25zKGxheWVyRGVzY3JpcHRvcik7XG4gICAgICAgIGNvbnN0IGJ1aWxkT3B0aW9ucyA9IHRoaXMubWVyZ2VCdWlsZE9wdGlvbnMoXG4gICAgICAgICAgICBsYXllck5hbWUsXG4gICAgICAgICAgICBsYXllckNvbmZpZy5idWlsZE9wdGlvbnMsXG4gICAgICAgICAgICBkZWNvcmF0b3JCdWlsZE9wdGlvbnNcbiAgICAgICAgKTtcbiAgICAgICAgXG4gICAgICAgIC8vIERldGVybWluZSBwYWNrYWdlIHN0cnVjdHVyZTpcbiAgICAgICAgLy8gLSBJZiBwYWNrYWdlUGF0aCBpcyBzZXQ6IHVzZSBpdCBhcyB0aGUgZnVsbCBtb2R1bGUgcGF0aCAoZS5nLiwgQHRlbjI0Z3JvdXAvZncyNClcbiAgICAgICAgLy8gLSBJZiBub3Qgc2V0OiB1c2UgZmlsZUJhc2VOYW1lIGFzIHRoZSBwYWNrYWdlIG5hbWUgKGUuZy4sIGRpLCBzaGFyZWQpXG4gICAgICAgIGNvbnN0IHBhY2thZ2VOYW1lID0gbGF5ZXJDb25maWcucGFja2FnZVBhdGggfHwgZmlsZUJhc2VOYW1lO1xuICAgICAgICBjb25zdCBjb25maWd1cmVkT3V0cHV0UGF0aCA9IGBub2RlanMvbm9kZV9tb2R1bGVzLyR7cGFja2FnZU5hbWV9YDtcbiAgICBcbiAgICAgICAgY29uc3Qgb3V0cHV0RGlyID0gcGF0aEpvaW4oZGlzdERpcmVjdG9yeSwgbGF5ZXJOYW1lLCBjb25maWd1cmVkT3V0cHV0UGF0aCk7XG4gICAgICAgIGNvbnN0IGJ1bmRsZURpciA9IHBhdGhKb2luKGRpc3REaXJlY3RvcnksIGxheWVyTmFtZSk7XG5cbiAgICAgICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgICAgIC8vIEJVSUxEIExBWUVSOiBlc2J1aWxkICsgbnBtIGluc3RhbGwgKHdpdGggbnBtIGluc3RhbGwgY2FjaGluZylcbiAgICAgICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIEJ1aWxkaW5nIGxheWVyLi4uYCk7XG4gICAgICAgIGNvbnN0IGJ1aWxkU3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgICAgICAvLyBFbnN1cmUgb3V0cHV0IGRpcmVjdG9yeSBleGlzdHNcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKG91dHB1dERpcikpIHtcbiAgICAgICAgICAgIG1rZGlyU3luYyhvdXRwdXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSW5zdGFsbCBleHRlcm5hbCBkZXBlbmRlbmNpZXMgRklSU1QgKHdpdGggc21hcnQgY2FjaGluZyB0byBza2lwIGlmIHVuY2hhbmdlZClcbiAgICAgICAgY29uc3QgZXh0ZXJuYWxQYWNrYWdlcyA9IChidWlsZE9wdGlvbnMuZXh0ZXJuYWwgJiYgQXJyYXkuaXNBcnJheShidWlsZE9wdGlvbnMuZXh0ZXJuYWwpKSA/IGJ1aWxkT3B0aW9ucy5leHRlcm5hbCA6IFtdO1xuICAgICAgICBpZiAoZXh0ZXJuYWxQYWNrYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBbMS8yXSBJbnN0YWxsaW5nIGV4dGVybmFsIGRlcGVuZGVuY2llcy4uLmApO1xuICAgICAgICAgICAgYXdhaXQgaW5zdGFsbEV4dGVybmFsRGVwZW5kZW5jaWVzT3B0aW1pemVkKGJ1bmRsZURpciwgZXh0ZXJuYWxQYWNrYWdlcywgdGhpcy5sb2dnZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVGhlbiBidW5kbGUgYXBwbGljYXRpb24gY29kZSBpbnRvIG5vZGVfbW9kdWxlc1xuICAgICAgICBjb25zdCBvdXRwdXRGaWxlID0gcGF0aEpvaW4ob3V0cHV0RGlyLCAnaW5kZXguanMnKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gWzIvMl0gQnVuZGxpbmcgd2l0aCBlc2J1aWxkLi4uYCk7XG4gICAgICAgIGF3YWl0IGJ1bmRsZVdpdGhFc2J1aWxkKGZpbGUsIG91dHB1dEZpbGUsIGJ1aWxkT3B0aW9ucyk7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBlbGFwc2VkID0gKChEYXRlLm5vdygpIC0gYnVpbGRTdGFydFRpbWUpIC8gMTAwMCkudG9GaXhlZCgxKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0g4pyTIEJ1aWxkIGNvbXBsZXRlIGluICR7ZWxhcHNlZH1zYClcblxuICAgICAgICAvLyBJbXBvcnQgcGF0aDogL29wdC9ub2RlanMvbm9kZV9tb2R1bGVzL3twYWNrYWdlTmFtZX0vaW5kZXguanNcbiAgICAgICAgLy8gTm9kZS5qcyB3aWxsIHJlc29sdmUgdGhpcyB0byB0aGUgYnVuZGxlZCBlbnRyeSBwb2ludFxuICAgICAgICBjb25zdCBsYXllckltcG9ydFBhdGggPSBwYXRoSm9pbignL29wdCcsIGNvbmZpZ3VyZWRPdXRwdXRQYXRoLCAnaW5kZXguanMnKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gTGF5ZXIgaW1wb3J0IHBhdGg6ICR7bGF5ZXJJbXBvcnRQYXRofWApO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGxheWVyTmFtZSwgbGF5ZXJJbXBvcnRQYXRoLCAnbGF5ZXJJbXBvcnRQYXRoJyk7XG5cbiAgICAgICAgaWYoaXNHbG9iYWxMYXllcihsYXllckRlc2NyaXB0b3IpKXtcbiAgICAgICAgICAgIC8vIEF0dGFjaCB0aGlzIGxheWVyIHRvIGFsbCBMYW1iZGEgZnVuY3Rpb25zXG4gICAgICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyhsYXllck5hbWUpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBPbmx5IGFkZCBhcyBlbnRyeSBwYWNrYWdlIGlmIGl0IG5lZWRzIHRvIGV4ZWN1dGUgYXQgbW9kdWxlIGluaXRpYWxpemF0aW9uXG4gICAgICAgICAgICBpZiAoaXNFbnRyeVBhY2thZ2UobGF5ZXJEZXNjcmlwdG9yKSkge1xuICAgICAgICAgICAgLy8gY29sbGVjdCBnbG9iYWwgZW50cnktcGFja2FnZXMgZm9yIGxhbWJkYXMgd2l0aCBwcmlvcml0eSBmb3IgY29ycmVjdCBsb2FkaW5nIG9yZGVyXG4gICAgICAgICAgICAvLyBQcmlvcml0eSBpcyBhbHdheXMgc2V0IGluIGNvbnN0cnVjdCgpLCBzbyBpdCBtdXN0IGJlIGRlZmluZWQgaGVyZVxuICAgICAgICAgICAgaWYgKGxheWVyQ29uZmlnLnByaW9yaXR5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYExheWVyICR7bGF5ZXJOYW1lfSBoYXMgbm8gcHJpb3JpdHkuIFRoaXMgc2hvdWxkIG5ldmVyIGhhcHBlbi5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuZncyNC5hZGRHbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2UoYGVudjpsYXllckltcG9ydFBhdGg6JHtsYXllck5hbWV9YCwgbGF5ZXJDb25maWcucHJpb3JpdHkpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIFJlZ2lzdGVyZWQgYXMgZW50cnkgcGFja2FnZSAocHJpb3JpdHk6ICR7bGF5ZXJDb25maWcucHJpb3JpdHl9KWApO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBMYXllciBhdHRhY2hlZCBidXQgTk9UIGFuIGVudHJ5IHBhY2thZ2UgKGF2YWlsYWJsZSBmb3IgaW1wb3J0IG9ubHkpYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYXllclByb3BzID0gZ2V0TGF5ZXJQcm9wcyhsYXllckRlc2NyaXB0b3IpO1xuXG4gICAgICAgIGNvbnN0IGRlZmF1bHRMYXllclByb3BzOiBMYXllclZlcnNpb25Qcm9wcyA9IHtcbiAgICAgICAgICAgIGxheWVyVmVyc2lvbk5hbWU6IGxheWVyTmFtZSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVSdW50aW1lczogWyBSdW50aW1lLk5PREVKU18yMl9YIF0sXG4gICAgICAgICAgICBjb2RlOiBDb2RlLmZyb21Bc3NldChidW5kbGVEaXIpLFxuICAgICAgICAgICAgY29tcGF0aWJsZUFyY2hpdGVjdHVyZXM6IFtBcmNoaXRlY3R1cmUuQVJNXzY0XSxcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBsYXllciA9IG5ldyBMYXllclZlcnNpb24odGhpcy5tYWluU3RhY2ssIGxheWVyTmFtZSArICctbGF5ZXInLCB7XG4gICAgICAgICAgICAuLi5kZWZhdWx0TGF5ZXJQcm9wcyxcbiAgICAgICAgICAgIC4uLmxheWVyQ29uZmlnLmxheWVyUHJvcHMsXG4gICAgICAgICAgICAuLi5sYXllclByb3BzLCAvLyB0aGUgbGF5ZXJQcm9wcyBmcm9tIHRoZSBkZWNvcmF0b3IgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgbGF5ZXJOYW1lLCBsYXllciwgT3V0cHV0VHlwZS5MQVlFUiwgJ2xheWVyVmVyc2lvbkFybicpO1xuXG4gICAgICAgIC8vIENsZWFuIHVwIHRoZSB0ZW1wb3Jhcnkgb3V0cHV0IGRpcmVjdG9yeSBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmIChsYXllckNvbmZpZy5jbGVhck91dHB1dERpcikge1xuICAgICAgICAgICAgY2xlYW51cERpcmVjdG9yeShvdXRwdXREaXIpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IHNjYW5zIGEgZGlyZWN0b3J5IGFuZCByZXR1cm5zIGEgbGlzdCBvZiBUeXBlU2NyaXB0IGZpbGVzLlxuICogQHBhcmFtIGRpcmVjdG9yeSAtIFRoZSBkaXJlY3RvcnkgdG8gc2Nhbi5cbiAqIEByZXR1cm5zIEFuIGFycmF5IG9mIFR5cGVTY3JpcHQgZmlsZSBwYXRocy5cbiAqL1xuZnVuY3Rpb24gc2NhbkRpcmVjdG9yeShkaXJlY3Rvcnk6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBsZXQgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgaXRlbXMgPSByZWFkZGlyU3luYyhkaXJlY3RvcnkpO1xuXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gcGF0aEpvaW4oZGlyZWN0b3J5LCBpdGVtKTtcbiAgICAgICAgY29uc3Qgc3RhdCA9IHN0YXRTeW5jKGZ1bGxQYXRoKTtcblxuICAgICAgICBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBmaWxlcyA9IGZpbGVzLmNvbmNhdChzY2FuRGlyZWN0b3J5KGZ1bGxQYXRoKSk7XG4gICAgICAgIH0gZWxzZSBpZiAoc3RhdC5pc0ZpbGUoKSAmJiBmdWxsUGF0aC5lbmRzV2l0aCgnLnRzJykpIHtcbiAgICAgICAgICAgIGZpbGVzLnB1c2goZnVsbFBhdGgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbGVzO1xufVxuXG5mdW5jdGlvbiBpc0xheWVyRW50cnkodGFyZ2V0OiBGdW5jdGlvbik6IGJvb2xlYW4ge1xuICAgIHJldHVybiAhIWdldExheWVyTmFtZSh0YXJnZXQpO1xufVxuXG5mdW5jdGlvbiBpc0dsb2JhbExheWVyKHRhcmdldDogRnVuY3Rpb24pOiBib29sZWFuIHtcbiAgICByZXR1cm4gIVJlZmxlY3QuZ2V0KHRhcmdldCwgJ25vdEdsb2JhbCcpO1xufVxuXG5mdW5jdGlvbiBpc0VudHJ5UGFja2FnZSh0YXJnZXQ6IEZ1bmN0aW9uKTogYm9vbGVhbiB7XG4gICAgY29uc3QgdmFsdWUgPSBSZWZsZWN0LmdldCh0YXJnZXQsICdpc0VudHJ5UGFja2FnZScpO1xuICAgIC8vIERlZmF1bHQgdG8gdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXG4gICAgcmV0dXJuIHZhbHVlICE9PSBmYWxzZTtcbn1cblxuZnVuY3Rpb24gZ2V0TGF5ZXJOYW1lKHRhcmdldDogRnVuY3Rpb24pIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGFyZ2V0LCAnbGF5ZXJOYW1lJyk7XG59XG5cbmZ1bmN0aW9uIGdldExheWVyQnVpbGRPcHRpb25zKHRhcmdldDogRnVuY3Rpb24pOiBCdWlsZE9wdGlvbnMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsICdidWlsZE9wdGlvbnMnKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldExheWVyUHJvcHModGFyZ2V0OiBGdW5jdGlvbik6IExheWVyVmVyc2lvblByb3BzIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGFyZ2V0LCAnbGF5ZXJQcm9wcycpO1xufVxuXG4vKipcbiAqIEJ1bmRsZXMgYSBUeXBlU2NyaXB0IGZpbGUgdXNpbmcgZXNidWlsZCB3aXRoIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICogQnVpbGQgb3B0aW9ucyBzaG91bGQgYWxyZWFkeSBiZSBtZXJnZWQgdmlhIG1lcmdlQnVpbGRPcHRpb25zKCkuXG4gKiBAcGFyYW0gZW50cnlGaWxlIC0gVGhlIGVudHJ5IGZpbGUgdG8gYnVuZGxlLlxuICogQHBhcmFtIG91dHB1dEZpbGUgLSBUaGUgb3V0cHV0IGZpbGUgcGF0aCBmb3IgdGhlIGJ1bmRsZS5cbiAqIEBwYXJhbSBidWlsZE9wdGlvbnMgLSBQcmUtbWVyZ2VkIGJ1aWxkIG9wdGlvbnMgZm9yIGVzYnVpbGQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGJ1bmRsZVdpdGhFc2J1aWxkKGVudHJ5RmlsZTogc3RyaW5nLCBvdXRwdXRGaWxlOiBzdHJpbmcsIGJ1aWxkT3B0aW9uczogQnVpbGRPcHRpb25zKSB7XG4gICAgY29uc3QgZmluYWxPcHRpb25zOiBCdWlsZE9wdGlvbnMgPSB7XG4gICAgICAgIC4uLmJ1aWxkT3B0aW9ucyxcbiAgICAgICAgb3V0ZmlsZTogb3V0cHV0RmlsZSxcbiAgICAgICAgZW50cnlQb2ludHM6IFtlbnRyeUZpbGVdLFxuICAgIH07XG5cbiAgICBEZWZhdWx0TG9nZ2VyLmRlYnVnKGBidW5kbGVXaXRoRXNidWlsZDogJHtlbnRyeUZpbGV9IOKGkiAke291dHB1dEZpbGV9YCk7XG4gICAgXG4gICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgYnVpbGQoZmluYWxPcHRpb25zKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gYnVuZGxlICR7ZW50cnlGaWxlfTpgLCBlcnJvcik7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgZXNidWlsZCBmYWlsZWQgZm9yICR7ZW50cnlGaWxlfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgfVxufVxuXG4vKipcbiAqIENhbGN1bGF0ZXMgaGFzaCBvZiBhIGZpbGUncyBjb250ZW50c1xuICovXG5mdW5jdGlvbiBjYWxjdWxhdGVGaWxlSGFzaChmaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBjb250ZW50ID0gcmVhZEZpbGVTeW5jKGZpbGVQYXRoKTtcbiAgICByZXR1cm4gY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKGNvbnRlbnQpLmRpZ2VzdCgnaGV4Jyk7XG59XG5cbi8qKlxuICogSGFzaGVzIGEgZGlyZWN0b3J5J3MgY29udGVudHMgcmVjdXJzaXZlbHkgZm9yIGNoYW5nZSBkZXRlY3Rpb25cbiAqIFVzZWQgZm9yIGxvY2FsIHBhY2thZ2UgZGVwZW5kZW5jaWVzIHRvIGRldGVjdCB3aGVuIHRoZXkndmUgYmVlbiByZWJ1aWx0XG4gKiBAcGFyYW0gZGlyUGF0aCAtIERpcmVjdG9yeSB0byBoYXNoICh0eXBpY2FsbHkgYSBkaXN0IGZvbGRlcilcbiAqIEByZXR1cm5zIFNIQS0yNTYgaGFzaCBvZiBhbGwgZmlsZSBjb250ZW50c1xuICovXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IGhhc2hlcyB0aGUgY29udGVudHMgb2YgYSBkaXJlY3RvcnkgZm9yIGNoYW5nZSBkZXRlY3Rpb24uXG4gKiBTa2lwcyBjb21tb24gbm9uLXJ1bnRpbWUgZGlyZWN0b3JpZXMgKG5vZGVfbW9kdWxlcywgLmdpdCwgdGVzdCwgZXRjLilcbiAqIFJldHVybnMgY29uc2lzdGVudCBTSEEtMjU2IGhhc2ggZXZlbiBmb3IgZW1wdHkgZGlyZWN0b3JpZXMuXG4gKiBcbiAqIEBwYXJhbSBkaXJQYXRoIC0gQWJzb2x1dGUgcGF0aCB0byBkaXJlY3RvcnkgdG8gaGFzaFxuICogQHJldHVybnMgU0hBLTI1NiBoYXNoICg2NCBoZXggY2hhcmFjdGVycylcbiAqL1xuZnVuY3Rpb24gaGFzaERpcmVjdG9yeUNvbnRlbnRzKGRpclBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgaGFzaCA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpO1xuICAgIGxldCBmaWxlQ291bnQgPSAwO1xuICAgIFxuICAgIGNvbnN0IGhhc2hEaXJSZWN1cnNpdmUgPSAoY3VycmVudFBhdGg6IHN0cmluZykgPT4ge1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoY3VycmVudFBhdGgpKSByZXR1cm47XG4gICAgICAgIFxuICAgICAgICBjb25zdCBzdGF0ID0gbHN0YXRTeW5jKGN1cnJlbnRQYXRoKTtcbiAgICAgICAgXG4gICAgICAgIGlmIChzdGF0LmlzU3ltYm9saWNMaW5rKCkpIHtcbiAgICAgICAgICAgIC8vIFNraXAgc3ltbGlua3MgdG8gYXZvaWQgaW5maW5pdGUgbG9vcHMgYW5kIGluY29uc2lzdGVudCBiZWhhdmlvclxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBjb25zdCBpdGVtcyA9IHJlYWRkaXJTeW5jKGN1cnJlbnRQYXRoKS5zb3J0KChhLCBiKSA9PiBhLmxvY2FsZUNvbXBhcmUoYikpOyAvLyBTb3J0IGZvciBkZXRlcm1pbmlzdGljIGhhc2hpbmdcbiAgICAgICAgICAgIGZvcihjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgICAgICAgICAgLy8gU2tpcCBjb21tb24gZGlyZWN0b3JpZXMgdGhhdCBkb24ndCBhZmZlY3QgcnVudGltZVxuICAgICAgICAgICAgICAgIGlmIChpdGVtID09PSAnbm9kZV9tb2R1bGVzJyB8fCBpdGVtID09PSAnLmdpdCcgfHwgXG4gICAgICAgICAgICAgICAgICAgIGl0ZW0gPT09ICd0ZXN0JyB8fCBpdGVtID09PSAnX190ZXN0c19fJyB8fCBcbiAgICAgICAgICAgICAgICAgICAgaXRlbSA9PT0gJ2NvdmVyYWdlJyB8fCBpdGVtID09PSAnLkRTX1N0b3JlJykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGhhc2hEaXJSZWN1cnNpdmUocGF0aEpvaW4oY3VycmVudFBhdGgsIGl0ZW0pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChzdGF0LmlzRmlsZSgpKSB7XG4gICAgICAgICAgICBmaWxlQ291bnQrKztcbiAgICAgICAgICAgIC8vIEhhc2ggZmlsZSBwYXRoIChyZWxhdGl2ZSkgZm9yIHVuaXF1ZW5lc3NcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHBhdGhSZWxhdGl2ZShkaXJQYXRoLCBjdXJyZW50UGF0aCk7XG4gICAgICAgICAgICBoYXNoLnVwZGF0ZShyZWxhdGl2ZVBhdGgpO1xuICAgICAgICAgICAgLy8gSGFzaCBmaWxlIGNvbnRlbnRzXG4gICAgICAgICAgICBoYXNoLnVwZGF0ZShyZWFkRmlsZVN5bmMoY3VycmVudFBhdGgpKTtcbiAgICAgICAgfVxuICAgIH07XG4gICAgXG4gICAgLy8gSGFzaCB0aGUgZGlyZWN0b3J5IHBhdGggaXRzZWxmIGZpcnN0IGZvciB1bmlxdWVuZXNzXG4gICAgaGFzaC51cGRhdGUoZGlyUGF0aCk7XG4gICAgaGFzaERpclJlY3Vyc2l2ZShkaXJQYXRoKTtcbiAgICBcbiAgICAvLyBJZiBubyBmaWxlcyB3ZXJlIGZvdW5kLCB1cGRhdGUgaGFzaCB3aXRoIHNlbnRpbmVsIHZhbHVlXG4gICAgLy8gVGhpcyBlbnN1cmVzIGVtcHR5IGRpcmVjdG9yaWVzIGhhdmUgYSBkaWZmZXJlbnQgaGFzaCB0aGFuIG5vbi1leGlzdGVudCBvbmVzXG4gICAgaWYgKGZpbGVDb3VudCA9PT0gMCkge1xuICAgICAgICBoYXNoLnVwZGF0ZSgnX19FTVBUWV9ESVJFQ1RPUllfXycpO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gaGFzaC5kaWdlc3QoJ2hleCcpO1xufVxuXG5cbi8qKlxuICogQ2xlYW5zIHVwIGEgdGVtcG9yYXJ5IGRpcmVjdG9yeSBieSByZW1vdmluZyBhbGwgZmlsZXMgYW5kIHN1YmRpcmVjdG9yaWVzLlxuICogQHBhcmFtIGRpcmVjdG9yeSAtIFRoZSBkaXJlY3RvcnkgdG8gY2xlYW4gdXAuXG4gKi9cbmZ1bmN0aW9uIGNsZWFudXBEaXJlY3RvcnkoZGlyZWN0b3J5OiBzdHJpbmcpIHtcbiAgICB0cnkge1xuICAgICAgICBybVN5bmMoZGlyZWN0b3J5LCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgYnVuZGxlV2l0aEVzYnVpbGQ6IENsZWFuZWQgdXAgdGVtcG9yYXJ5IGRpcmVjdG9yeTogJHtkaXJlY3Rvcnl9YCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5lcnJvcihgYnVuZGxlV2l0aEVzYnVpbGQ6IEZhaWxlZCB0byBjbGVhbiB1cCBkaXJlY3RvcnkgJHtkaXJlY3Rvcnl9OmAsIGVycm9yKTtcbiAgICB9XG59XG5cbi8qKlxuICogT1BUSU1JWkVEOiBJbnN0YWxscyBleHRlcm5hbCBkZXBlbmRlbmNpZXMgd2l0aCBpbnRlbGxpZ2VudCBjYWNoaW5nXG4gKiBcbiAqIEBwYXJhbSBsYXllck91dHB1dERpciAtIFRoZSBPVVRQVVQgZGlyZWN0b3J5IGZvciB0aGUgbGF5ZXIgKGUuZy4sIGRpc3QvbGF5ZXJzL2RpKVxuICogQHBhcmFtIGV4dGVybmFsUGFja2FnZXMgLSBBcnJheSBvZiBwYWNrYWdlIG5hbWVzIHRvIGluc3RhbGwgKGUuZy4sIFsnYXhpb3MnLCAnZmlyZWJhc2UtYWRtaW4nXSlcbiAqIEBwYXJhbSBsb2dnZXIgLSBMb2dnZXIgaW5zdGFuY2UgZm9yIG91dHB1dFxuICovXG5hc3luYyBmdW5jdGlvbiBpbnN0YWxsRXh0ZXJuYWxEZXBlbmRlbmNpZXNPcHRpbWl6ZWQobGF5ZXJPdXRwdXREaXI6IHN0cmluZywgZXh0ZXJuYWxQYWNrYWdlczogKHN0cmluZyB8IFJlZ0V4cClbXSwgbG9nZ2VyOiBhbnkpIHtcbiAgICAvLyBGaWx0ZXIgb3V0IHJlZ2V4IHBhdHRlcm5zLCBmcmFtZXdvcmsgcGFja2FnZXMsIGFuZCBwYWNrYWdlcyBwcm92aWRlZCBieSBvdGhlciBsYXllcnNcbiAgICBjb25zdCBwYWNrYWdlTmFtZXMgPSBleHRlcm5hbFBhY2thZ2VzLmZpbHRlcihwa2cgPT4gXG4gICAgICAgIHR5cGVvZiBwa2cgPT09ICdzdHJpbmcnICYmIFxuICAgICAgICAhcGtnLnN0YXJ0c1dpdGgoJ0Bhd3Mtc2RrJykgJiYgICAgICAvLyBQcm92aWRlZCBieSBMYW1iZGEgcnVudGltZVxuICAgICAgICAhcGtnLnN0YXJ0c1dpdGgoJ0BzbWl0aHknKSAmJiAgICAgICAvLyBQcm92aWRlZCBieSBMYW1iZGEgcnVudGltZVxuICAgICAgICAhcGtnLnN0YXJ0c1dpdGgoJ2F3cy1jZGstbGliJykgJiYgICAvLyBCdWlsZC10aW1lIG9ubHlcbiAgICAgICAgcGtnICE9PSAnZXNidWlsZCcgJiYgICAgICAgICAgICAgICAgLy8gQnVpbGQtdGltZSBvbmx5XG4gICAgICAgIHBrZyAhPT0gJ0B0ZW4yNGdyb3VwL2Z3MjQnICAgICAgICAgIC8vIFByb3ZpZGVkIGJ5IGZ3MjQgcnVudGltZSBsYXllciAobm90IGRpIGxheWVyKVxuICAgICkgYXMgc3RyaW5nW107XG5cbiAgICBpZiAocGFja2FnZU5hbWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgbm9kZWpzRGlyID0gcGF0aEpvaW4obGF5ZXJPdXRwdXREaXIsICdub2RlanMnKTtcbiAgICBjb25zdCBub2RlTW9kdWxlc0RpciA9IHBhdGhKb2luKG5vZGVqc0RpciwgJ25vZGVfbW9kdWxlcycpO1xuICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHBhdGhKb2luKG5vZGVqc0RpciwgJ3BhY2thZ2UuanNvbicpO1xuICAgIGNvbnN0IHBhY2thZ2VIYXNoUGF0aCA9IHBhdGhKb2luKG5vZGVqc0RpciwgJy5wYWNrYWdlLWhhc2gnKTtcbiAgICBcbiAgICAvLyBCdWlsZCBkZXNpcmVkIHBhY2thZ2UuanNvblxuICAgIGNvbnN0IHBhY2thZ2VKc29uOiBhbnkgPSB7XG4gICAgICAgIG5hbWU6ICdsYXllci1kZXBlbmRlbmNpZXMnLFxuICAgICAgICB2ZXJzaW9uOiAnMS4wLjAnLFxuICAgICAgICBkZXBlbmRlbmNpZXM6IHt9XG4gICAgfTtcblxuICAgIC8vIFJlYWQgdGhlIHByb2plY3QncyBwYWNrYWdlLmpzb24gdG8gZ2V0IHZlcnNpb24gbnVtYmVyc1xuICAgIGNvbnN0IHByb2plY3RSb290ID0gcGF0aFJlc29sdmUocHJvY2Vzcy5jd2QoKSk7XG4gICAgY29uc3QgcHJvamVjdFBhY2thZ2VKc29uUGF0aCA9IHBhdGhKb2luKHByb2plY3RSb290LCAncGFja2FnZS5qc29uJyk7XG4gICAgXG4gICAgLy8gVHJhY2sgbG9jYWwgcGFja2FnZSBjb250ZW50IGhhc2hlcyBmb3IgY2hhbmdlIGRldGVjdGlvblxuICAgIGNvbnN0IGxvY2FsUGFja2FnZUhhc2hlczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICAgIFxuICAgIGlmICghZXhpc3RzU3luYyhwcm9qZWN0UGFja2FnZUpzb25QYXRoKSkge1xuICAgICAgICBsb2dnZXIud2FybihgcGFja2FnZS5qc29uIG5vdCBmb3VuZCBhdCAke3Byb2plY3RQYWNrYWdlSnNvblBhdGh9LCBpbnN0YWxsaW5nIGxhdGVzdCB2ZXJzaW9uc2ApO1xuICAgICAgICBmb3IoY29uc3QgcGtnIG9mIHBhY2thZ2VOYW1lcykge1xuICAgICAgICAgICAgcGFja2FnZUpzb24uZGVwZW5kZW5jaWVzW3BrZ10gPSAnbGF0ZXN0JztcbiAgICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHByb2plY3RQYWNrYWdlSnNvbiA9IEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKHByb2plY3RQYWNrYWdlSnNvblBhdGgsICd1dGYtOCcpKTtcbiAgICAgICAgLy8gT05MWSB1c2UgcnVudGltZSBkZXBlbmRlbmNpZXMgLSBkZXZEZXBlbmRlbmNpZXMgYXJlIGJ1aWxkLXRpbWUgdG9vbHMsIG5vdCBMYW1iZGEgcnVudGltZSFcbiAgICAgICAgY29uc3QgcnVudGltZURlcHMgPSBwcm9qZWN0UGFja2FnZUpzb24uZGVwZW5kZW5jaWVzIHx8IHt9O1xuXG4gICAgICAgIGZvcihjb25zdCBwa2cgb2YgcGFja2FnZU5hbWVzKSB7XG4gICAgICAgICAgICBpZiAocnVudGltZURlcHNbcGtnXSkge1xuICAgICAgICAgICAgICAgIGxldCBkZXBWYWx1ZSA9IHJ1bnRpbWVEZXBzW3BrZ107XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gSGFuZGxlIGxvY2FsIGZpbGVzeXN0ZW0gZGVwZW5kZW5jaWVzIChlLmcuLCBcIi4uL2Z3MjQvXCIsIFwiZmlsZTouLi9mdzI0XCIsIG9yIFwiLi5cXGZ3MjRcIiBvbiBXaW5kb3dzKVxuICAgICAgICAgICAgICAgIGNvbnN0IGlzTG9jYWxEZXAgPSBkZXBWYWx1ZS5zdGFydHNXaXRoKCdmaWxlOicpIHx8IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVwVmFsdWUuc3RhcnRzV2l0aCgnLi4vJykgfHwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXBWYWx1ZS5zdGFydHNXaXRoKCcuLycpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXBWYWx1ZS5zdGFydHNXaXRoKCcuLlxcXFwnKSB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlcFZhbHVlLnN0YXJ0c1dpdGgoJy5cXFxcJyk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGlzTG9jYWxEZXApIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbG9jYWxQYXRoID0gZGVwVmFsdWUucmVwbGFjZSgnZmlsZTonLCAnJyk7XG4gICAgICAgICAgICAgICAgICAgIC8vIFJlc29sdmUgYWJzb2x1dGUgcGF0aCBvZiB0aGUgbG9jYWwgcGFja2FnZVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSBwYXRoUmVzb2x2ZShwcm9qZWN0Um9vdCwgbG9jYWxQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIFZhbGlkYXRlIGxvY2FsIHBhY2thZ2UgZXhpc3RzXG4gICAgICAgICAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhhYnNvbHV0ZVBhdGgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlcnJvck1zZyA9IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBg4p2MIExvY2FsIHBhY2thZ2UgXCIke3BrZ31cIiBwYXRoIGRvZXMgbm90IGV4aXN0OiAke2Fic29sdXRlUGF0aH1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICBTcGVjaWZpZWQgaW4gcGFja2FnZS5qc29uIGFzOiAke2RlcFZhbHVlfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIFJlc29sdmVkIGZyb20gcHJvamVjdCByb290OiAke3Byb2plY3RSb290fWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIFBsZWFzZSBlbnN1cmUgdGhlIGxvY2FsIHBhY2thZ2UgcGF0aCBpcyBjb3JyZWN0LmBcbiAgICAgICAgICAgICAgICAgICAgICAgIF0uam9pbignXFxuJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXIuZXJyb3IoZXJyb3JNc2cpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBMb2NhbCBwYWNrYWdlIHBhdGggbm90IGZvdW5kOiAke3BrZ30gLT4gJHthYnNvbHV0ZVBhdGh9YCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIENSSVRJQ0FMOiBWYWxpZGF0ZSB0aGF0IGxvY2FsIHBhY2thZ2UgaXMgYnVpbHQgKGhhcyBkaXN0IGZvbGRlcilcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlzdFBhdGggPSBwYXRoSm9pbihhYnNvbHV0ZVBhdGgsICdkaXN0Jyk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhkaXN0UGF0aCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTXNnID0gW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGDinYwgTG9jYWwgcGFja2FnZSBcIiR7cGtnfVwiIGhhcyBubyBkaXN0IGZvbGRlcjogJHtkaXN0UGF0aH1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICBMb2NhbCBwYWNrYWdlcyBNVVNUIGJlIGJ1aWx0IGJlZm9yZSBiZWluZyB1c2VkIGFzIGRlcGVuZGVuY2llcy5gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICBQbGVhc2UgcnVuIHRoZSBidWlsZCBjb21tYW5kIGluOiAke2Fic29sdXRlUGF0aH1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICBFeGFtcGxlOiBjZCAke2Fic29sdXRlUGF0aH0gJiYgbnBtIHJ1biBidWlsZGBcbiAgICAgICAgICAgICAgICAgICAgICAgIF0uam9pbignXFxuJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXIuZXJyb3IoZXJyb3JNc2cpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBMb2NhbCBwYWNrYWdlIG5vdCBidWlsdDogJHtwa2d9IChtaXNzaW5nIGRpc3QgZm9sZGVyKWApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyBIYXNoIHRoZSBkaXN0IGZvbGRlciBjb250ZW50cyBmb3IgY2hhbmdlIGRldGVjdGlvblxuICAgICAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4oaSIEhhc2hpbmcgbG9jYWwgcGFja2FnZSBcIiR7cGtnfVwiIGRpc3QgZm9sZGVyLi4uYCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRlbnRIYXNoID0gaGFzaERpcmVjdG9yeUNvbnRlbnRzKGRpc3RQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIFZhbGlkYXRlIGhhc2ggaXMgbm9uLWVtcHR5IChkaXN0IGZvbGRlciBoYXMgYWN0dWFsIGZpbGVzKVxuICAgICAgICAgICAgICAgICAgICBpZiAoY29udGVudEhhc2g/Lmxlbmd0aCAhPT0gNjQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvZ2dlci53YXJuKGAgICDimqDvuI8gIFVuZXhwZWN0ZWQgaGFzaCBmb3IgXCIke3BrZ31cIjogJHtjb250ZW50SGFzaH1gKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbG9jYWxQYWNrYWdlSGFzaGVzW3BrZ10gPSBjb250ZW50SGFzaDtcbiAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKGkiBMb2NhbCBwYWNrYWdlIFwiJHtwa2d9XCIgaGFzaDogJHtjb250ZW50SGFzaC5zdWJzdHJpbmcoMCwgMTIpfS4uLiAoJHtwa2d9KWApO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gQ2FsY3VsYXRlIHJlbGF0aXZlIHBhdGggZnJvbSBsYXllcidzIG5vZGVqcyBkaXIgdG8gbG9jYWwgcGFja2FnZVxuICAgICAgICAgICAgICAgICAgICBjb25zdCByZWxhdGl2ZVBhdGhGcm9tTGF5ZXIgPSBwYXRoUmVsYXRpdmUobm9kZWpzRGlyLCBhYnNvbHV0ZVBhdGgpO1xuICAgICAgICAgICAgICAgICAgICBkZXBWYWx1ZSA9IHJlbGF0aXZlUGF0aEZyb21MYXllcjtcbiAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKGkiBSZXNvbHZlZCBsb2NhbCBwYWNrYWdlIFwiJHtwa2d9XCI6ICR7cmVsYXRpdmVQYXRoRnJvbUxheWVyfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBwYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXNbcGtnXSA9IGRlcFZhbHVlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBQYWNrYWdlIG5vdCBmb3VuZCBpbiBkZXBlbmRlbmNpZXMgLSB0aGlzIGlzIGEgY29uZmlndXJhdGlvbiBlcnJvclxuICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTXNnID0gW1xuICAgICAgICAgICAgICAgICAgICBg4p2MIFBhY2thZ2UgXCIke3BrZ31cIiBub3QgZm91bmQgaW4gcnVudGltZSBkZXBlbmRlbmNpZXMuYCxcbiAgICAgICAgICAgICAgICAgICAgYCAgIFRoaXMgcGFja2FnZSBpcyBtYXJrZWQgYXMgJ2V4dGVybmFsJyBpbiB0aGUgbGF5ZXIgYnVpbGQgYnV0IGlzIG5vdCBpbiBwYWNrYWdlLmpzb24gZGVwZW5kZW5jaWVzLmAsXG4gICAgICAgICAgICAgICAgICAgIGAgICBBZGQgXCIke3BrZ31cIiB0byBkZXBlbmRlbmNpZXMgaW4gcGFja2FnZS5qc29uIHdpdGggYSBzcGVjaWZpYyB2ZXJzaW9uLmAsXG4gICAgICAgICAgICAgICAgICAgIGAgICBFeGFtcGxlOiBucG0gaW5zdGFsbCAke3BrZ30gLS1zYXZlYCxcbiAgICAgICAgICAgICAgICAgICAgYCAgIFRoZW4gcmVidWlsZCB0aGUgbGF5ZXIuYFxuICAgICAgICAgICAgICAgIF0uam9pbignXFxuJyk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGVycm9yTXNnKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcnVudGltZSBkZXBlbmRlbmN5OiAke3BrZ31gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBwYWNrYWdlSnNvbkNvbnRlbnQgPSBKU09OLnN0cmluZ2lmeShwYWNrYWdlSnNvbiwgbnVsbCwgMik7XG4gICAgY29uc3QgaGFzaCA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpO1xuICAgIGhhc2gudXBkYXRlKHBhY2thZ2VKc29uQ29udGVudCk7XG4gICAgXG4gICAgLy8gQ1JJVElDQUw6IEluY2x1ZGUgbG9jYWwgcGFja2FnZSBjb250ZW50IGhhc2hlcyBpbiB0aGUgY2FjaGUga2V5XG4gICAgLy8gVGhpcyBlbnN1cmVzIHdlIHJlaW5zdGFsbCB3aGVuIGxvY2FsIHBhY2thZ2VzIGNoYW5nZSAoZS5nLiwgZncyNCB1cGRhdGVzKVxuICAgIGlmIChPYmplY3Qua2V5cyhsb2NhbFBhY2thZ2VIYXNoZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGAgICDihpIgSW5jbHVkaW5nICR7T2JqZWN0LmtleXMobG9jYWxQYWNrYWdlSGFzaGVzKS5sZW5ndGh9IGxvY2FsIHBhY2thZ2UgY29udGVudCBoYXNoZXMgaW4gY2FjaGUga2V5YCk7XG4gICAgICAgIGZvcihjb25zdCBwa2cgb2YgT2JqZWN0LmtleXMobG9jYWxQYWNrYWdlSGFzaGVzKS5zb3J0KChhLCBiKSA9PiBhLmxvY2FsZUNvbXBhcmUoYikpKSB7XG4gICAgICAgICAgICBoYXNoLnVwZGF0ZShgJHtwa2d9OiR7bG9jYWxQYWNrYWdlSGFzaGVzW3BrZ119YCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgY29uc3QgY3VycmVudFBhY2thZ2VIYXNoID0gaGFzaC5kaWdlc3QoJ2hleCcpO1xuICAgIFxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIEZBU1QgUEFUSDogQ2hlY2sgaWYgd2UgY2FuIHNraXAgbnBtIGluc3RhbGxcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICBsZXQgc2tpcFJlYXNvbjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKCFleGlzdHNTeW5jKHBhY2thZ2VIYXNoUGF0aCkpIHtcbiAgICAgICAgc2tpcFJlYXNvbiA9ICdObyBwcmV2aW91cyBoYXNoIGZpbGUgZm91bmQgKGZpcnN0IGJ1aWxkKSc7XG4gICAgfSBlbHNlIGlmICghZXhpc3RzU3luYyhub2RlTW9kdWxlc0RpcikpIHtcbiAgICAgICAgc2tpcFJlYXNvbiA9ICdub2RlX21vZHVsZXMgZGlyZWN0b3J5IG5vdCBmb3VuZCc7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHByZXZpb3VzSGFzaCA9IHJlYWRGaWxlU3luYyhwYWNrYWdlSGFzaFBhdGgsICd1dGYtOCcpLnRyaW0oKTtcbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIGhhc2ggZm9ybWF0IChTSEEtMjU2ID0gNjQgaGV4IGNoYXJzKVxuICAgICAgICAgICAgaWYgKHByZXZpb3VzSGFzaC5sZW5ndGggIT09IDY0IHx8ICEvXlswLTlhLWZdezY0fSQvLnRlc3QocHJldmlvdXNIYXNoKSkge1xuICAgICAgICAgICAgICAgIHNraXBSZWFzb24gPSBgSW52YWxpZCBoYXNoIGZvcm1hdCBpbiBjYWNoZSBmaWxlIChnb3QgJHtwcmV2aW91c0hhc2gubGVuZ3RofSBjaGFycylgO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChwcmV2aW91c0hhc2ggPT09IGN1cnJlbnRQYWNrYWdlSGFzaCkge1xuICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGAgICDinJMgRGVwZW5kZW5jaWVzIHVuY2hhbmdlZCwgc2tpcHBpbmcgbnBtIGluc3RhbGwgKHNhdmVkIH4xMXMpYCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuOyAvLyBGQVNUIFBBVEggU1VDQ0VTUyFcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2tpcFJlYXNvbiA9ICdEZXBlbmRlbmN5IGNoYW5nZXMgZGV0ZWN0ZWQnO1xuICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGAgICDihpIgUHJldmlvdXMgaGFzaDogJHtwcmV2aW91c0hhc2guc3Vic3RyaW5nKDAsIDEyKX0uLi5gKTtcbiAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4oaSIEN1cnJlbnQgaGFzaDogICR7Y3VycmVudFBhY2thZ2VIYXNoLnN1YnN0cmluZygwLCAxMil9Li4uYCk7XG4gICAgICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKGxvY2FsUGFja2FnZUhhc2hlcykubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4oaSIExvY2FsIHBhY2thZ2VzIGluY2x1ZGVkIGluIGhhc2g6ICR7T2JqZWN0LmtleXMobG9jYWxQYWNrYWdlSGFzaGVzKS5qb2luKCcsICcpfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgc2tpcFJlYXNvbiA9IGBGYWlsZWQgdG8gcmVhZCBoYXNoIGZpbGU6ICR7ZXJyb3IubWVzc2FnZX1gO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIFNMT1cgUEFUSDogTmVlZCB0byBydW4gbnBtIGluc3RhbGxcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICBsb2dnZXIuaW5mbyhgICAg8J+TpiBSdW5uaW5nIG5wbSBpbnN0YWxsIChyZWFzb246ICR7c2tpcFJlYXNvbn0pYCk7XG4gICAgbG9nZ2VyLmluZm8oYCAgIOKGkiBJbnN0YWxsaW5nICR7cGFja2FnZU5hbWVzLmxlbmd0aH0gcGFja2FnZShzKTogJHtwYWNrYWdlTmFtZXMuam9pbignLCAnKX1gKTtcbiAgICBcbiAgICBjb25zdCBpbnN0YWxsU3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgIC8vIEVuc3VyZSBkaXJlY3RvcnkgZXhpc3RzXG4gICAgaWYgKCFleGlzdHNTeW5jKG5vZGVqc0RpcikpIHtcbiAgICAgICAgbWtkaXJTeW5jKG5vZGVqc0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgLy8gV3JpdGUgcGFja2FnZS5qc29uXG4gICAgd3JpdGVGaWxlU3luYyhwYWNrYWdlSnNvblBhdGgsIHBhY2thZ2VKc29uQ29udGVudCk7XG5cbiAgICAvLyBJbnN0YWxsIGRlcGVuZGVuY2llc1xuICAgIHRyeSB7XG4gICAgICAgIC8vIC0taW5zdGFsbC1saW5rcyBpcyBuZWVkZWQgdG8gaW5zdGFsbCBsb2NhbCBwYWNrYWdlcyBmcm9tIGZpbGU6IHJlZmVyZW5jZXNcbiAgICAgICAgLy8gLS1wcmVmZXItb2ZmbGluZSBpcyBuZWVkZWQgdG8gc3BlZWQgdXAgdGhlIGluc3RhbGxhdGlvblxuICAgICAgICAvLyAtLW5vLXBhY2thZ2UtbG9jayBpcyBuZWVkZWQgdG8gYXZvaWQgcGFja2FnZS1sb2NrLmpzb24gY29uZmxpY3RzXG4gICAgICAgIC8vIC0tb21pdD1kZXYgaXMgbmVlZGVkIHRvIGF2b2lkIGluc3RhbGxpbmcgZGV2IGRlcGVuZGVuY2llc1xuICAgICAgICBleGVjU3luYygnbnBtIGluc3RhbGwgLS1vbWl0PWRldiAtLW5vLXBhY2thZ2UtbG9jayAtLWluc3RhbGwtbGlua3MgLS1wcmVmZXItb2ZmbGluZScsIHtcbiAgICAgICAgICAgIGN3ZDogbm9kZWpzRGlyLFxuICAgICAgICAgICAgc3RkaW86ICdpbmhlcml0J1xuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGVsYXBzZWQgPSAoKERhdGUubm93KCkgLSBpbnN0YWxsU3RhcnRUaW1lKSAvIDEwMDApLnRvRml4ZWQoMSk7XG4gICAgICAgIGxvZ2dlci5pbmZvKGAgICDinJMgbnBtIGluc3RhbGwgY29tcGxldGUgaW4gJHtlbGFwc2VkfXNgKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFNhdmUgaGFzaCBmb3IgbmV4dCBydW5cbiAgICAgICAgd3JpdGVGaWxlU3luYyhwYWNrYWdlSGFzaFBhdGgsIGN1cnJlbnRQYWNrYWdlSGFzaCk7XG4gICAgICAgIFxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcignRmFpbGVkIHRvIGluc3RhbGwgZXh0ZXJuYWwgZGVwZW5kZW5jaWVzOicsIGVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IGNvcHkgYSBkaXJlY3RvcnlcbiAqL1xuZnVuY3Rpb24gY29weURpcmVjdG9yeShzb3VyY2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpIHtcbiAgICBpZiAoIWV4aXN0c1N5bmModGFyZ2V0KSkge1xuICAgICAgICBta2RpclN5bmModGFyZ2V0LCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICB9XG4gICAgY29uc3QgaXRlbXMgPSByZWFkZGlyU3luYyhzb3VyY2UpO1xuICAgIGZvcihjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgIGNvbnN0IHNvdXJjZVBhdGggPSBwYXRoSm9pbihzb3VyY2UsIGl0ZW0pO1xuICAgICAgICBjb25zdCB0YXJnZXRQYXRoID0gcGF0aEpvaW4odGFyZ2V0LCBpdGVtKTtcbiAgICAgICAgaWYgKGxzdGF0U3luYyhzb3VyY2VQYXRoKS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBjb3B5RGlyZWN0b3J5KHNvdXJjZVBhdGgsIHRhcmdldFBhdGgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29weUZpbGVTeW5jKHNvdXJjZVBhdGgsIHRhcmdldFBhdGgpO1xuICAgICAgICB9XG4gICAgfVxufVxuIl19