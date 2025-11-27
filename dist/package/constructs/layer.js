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
        // Use buildOptions.externalPackages if provided, otherwise fall back to buildOptions.external for backward compatibility
        // This allows separating packages to npm install from packages to mark as external in esbuild
        const externalPackages = buildOptions.externalPackages
            ? (Array.isArray(buildOptions.externalPackages) ? buildOptions.externalPackages : [])
            : (buildOptions.external && Array.isArray(buildOptions.external)) ? buildOptions.external : [];
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
        // Create package.json for Node.js module resolution
        // Without this, require('@package/name') won't work even if index.js exists
        const packageJsonPath = (0, node_path_1.join)(outputDir, 'package.json');
        const packageJson = {
            name: packageName,
            version: "1.0.0",
            main: "index.js",
            type: "commonjs"
        };
        (0, node_fs_1.writeFileSync)(packageJsonPath, JSON.stringify(packageJson, null, 2));
        this.logger.info(`[${layerName}]    ✓ Created package.json for module resolution`);
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
    // Default to FALSE - layers are NOT entry packages unless explicitly marked
    // Entry packages execute code at Lambda init; most layers are just runtime libraries
    return value === true;
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
 * @param buildOptions - Pre-merged build options (may include custom fields like externalPackages).
 */
async function bundleWithEsbuild(entryFile, outputFile, buildOptions) {
    // Strip out custom fields that esbuild doesn't recognize
    const { externalPackages: _externalPackages, ...esbuildOptions } = buildOptions;
    const finalOptions = {
        ...esbuildOptions,
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
        // --legacy-peer-deps is needed to skip peer dependencies (e.g., @ten24group/fw24 from fw24-auth-cognito)
        (0, node_child_process_1.execSync)('npm install --omit=dev --no-package-lock --install-links --prefer-offline --legacy-peer-deps', {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGF5ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9sYXllci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUE2aEJBLHNDQUVDO0FBN2hCRCwyQ0FBd0M7QUFDeEMsdUNBQW9DO0FBQ3BDLHVEQUF5RjtBQUN6Rix3Q0FBK0U7QUFDL0UsMENBQXVDO0FBQ3ZDLHVEQUFzRztBQUN0Ryx5Q0FBaUo7QUFDakoscUNBQXFJO0FBQ3JJLDJEQUE4QztBQUM5QyxxQ0FBOEM7QUFDOUMsOENBQTJDO0FBRTNDLDZDQUF5QztBQUN6QywwQ0FBdUM7QUF1SnZDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0EyQkc7QUFDSCxNQUFhLGNBQWM7SUFjTTtJQWJwQixNQUFNLENBQVU7SUFDaEIsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQUcsY0FBYyxDQUFDLElBQUksQ0FBQztJQUMzQixZQUFZLEdBQWEsRUFBRSxDQUFDO0lBQzVCLE1BQU0sQ0FBdUI7SUFFN0IsU0FBUyxDQUFTO0lBRWxCOzs7T0FHRztJQUNILFlBQTZCLE1BQStCLEVBQUUsVUFBb0I7UUFBckQsV0FBTSxHQUFOLE1BQU0sQ0FBeUI7UUFFeEQsSUFBRyxVQUFVLEVBQUMsQ0FBQztZQUNYLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDdkQsQ0FBQzthQUFNLENBQUM7WUFDSixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDcEQsQ0FBQztRQUVELGVBQWU7UUFDZixLQUFJLE1BQU0sV0FBVyxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQzlCLFdBQVcsQ0FBQyxJQUFJLEdBQUcsV0FB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QztJQUMzQyxDQUFDO0lBQ0QsTUFBTSxLQUFLLEdBQUcsSUFBQSxxQkFBVyxFQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ2xDLEtBQUksTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7UUFDdEIsTUFBTSxVQUFVLEdBQUcsSUFBQSxnQkFBUSxFQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztRQUMxQyxNQUFNLFVBQVUsR0FBRyxJQUFBLGdCQUFRLEVBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzFDLElBQUksSUFBQSxtQkFBUyxFQUFDLFVBQVUsQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7WUFDdEMsYUFBYSxDQUFDLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUMxQyxDQUFDO2FBQU0sQ0FBQztZQUNKLElBQUEsc0JBQVksRUFBQyxVQUFVLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFDekMsQ0FBQztJQUNMLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcblxuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmUvaGVscGVyXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgRGVmYXVsdExvZ2dlciwgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciwgSUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBUaW1lciB9IGZyb20gXCIuLi91dGlscy90aW1lclwiO1xuaW1wb3J0IHsgQXJjaGl0ZWN0dXJlLCBDb2RlLCBMYXllclZlcnNpb24sIExheWVyVmVyc2lvblByb3BzLCBSdW50aW1lIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBiYXNlbmFtZSBhcyBwYXRoQmFzZU5hbWUsIHJlc29sdmUgYXMgcGF0aFJlc29sdmUsIGpvaW4gYXMgcGF0aEpvaW4sIGV4dG5hbWUgYXMgcGF0aEV4dG5hbWUsIHJlbGF0aXZlIGFzIHBhdGhSZWxhdGl2ZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBleGlzdHNTeW5jLCBta2RpclN5bmMsIHJlYWRkaXJTeW5jLCBzdGF0U3luYywgcm1TeW5jLCBsc3RhdFN5bmMsIGNvcHlGaWxlU3luYywgcmVhZEZpbGVTeW5jLCB3cml0ZUZpbGVTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBleGVjU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBidWlsZCwgQnVpbGRPcHRpb25zIH0gZnJvbSAnZXNidWlsZCc7XG5pbXBvcnQgeyBMYXllckVudHJ5IH0gZnJvbSBcIi4uL2RlY29yYXRvcnNcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSBcIm5vZGU6Y3J5cHRvXCI7XG5pbXBvcnQgeyBtZXJnZSB9IGZyb20gXCIuLi91dGlscy9tZXJnZVwiO1xuXG4vKipcbiAqIEV4dGVuZGVkIGJ1aWxkIG9wdGlvbnMgdGhhdCBzdXBwb3J0IHNlcGFyYXRpbmcgbnBtIGluc3RhbGwgcGFja2FnZXMgZnJvbSBlc2J1aWxkIGV4dGVybmFsc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIEV4dGVuZGVkQnVpbGRPcHRpb25zIGV4dGVuZHMgQnVpbGRPcHRpb25zIHtcbiAgICAvKipcbiAgICAgKiBQYWNrYWdlcyB0byBucG0gaW5zdGFsbCBpbiB0aGUgbGF5ZXIncyBub2RlX21vZHVsZXMgKHJ1bnRpbWUgZGVwZW5kZW5jaWVzKS5cbiAgICAgKiBJZiBub3QgcHJvdmlkZWQsIGZhbGxzIGJhY2sgdG8gdXNpbmcgYGV4dGVybmFsYCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eS5cbiAgICAgKiBcbiAgICAgKiBVc2UgdGhpcyB0byBzZXBhcmF0ZSBwYWNrYWdlcyB0aGF0IHNob3VsZCBiZSBucG0gaW5zdGFsbGVkIGZyb20gcGFja2FnZXNcbiAgICAgKiB0aGF0IGFyZSBwcm92aWRlZCBieSBvdGhlciBsYXllcnMgKGUuZy4sIEB0ZW4yNGdyb3VwL2Z3MjQgZnJvbSBmdzI0IGxheWVyKS5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHtcbiAgICAgKiAgIGV4dGVybmFsOiBbJ0B0ZW4yNGdyb3VwL2Z3MjQnLCAnYXhpb3MnXSwgICAgICAgICAgIC8vIERvbid0IGJ1bmRsZSB0aGVzZVxuICAgICAqICAgZXh0ZXJuYWxQYWNrYWdlczogWydheGlvcyddICAgICAgICAgICAgICAgICAgICAgICAgLy8gT25seSBucG0gaW5zdGFsbCBheGlvc1xuICAgICAqIH0gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZncyNCBjb21lcyBmcm9tIGZ3MjQgbGF5ZXJcbiAgICAgKi9cbiAgICBleHRlcm5hbFBhY2thZ2VzPzogKHN0cmluZyB8IFJlZ0V4cClbXTtcbn1cblxuLyoqXG4gKiBDb21tb24gbGF5ZXIgY29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzXG4gKi9cbmludGVyZmFjZSBJQmFzZUxheWVyQ29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIHNvdXJjZSBwYXRoIG9mIHRoZSBsYXllciBkaXJlY3Rvcnkgb3IgZmlsZS5cbiAgICAgKi9cbiAgICBzb3VyY2VQYXRoOiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBwcm9wZXJ0aWVzIGZvciB0aGUgbGF5ZXIgdmVyc2lvbi5cbiAgICAgKi9cbiAgICBsYXllclByb3BzPzogT21pdDxMYXllclZlcnNpb25Qcm9wcywgJ2NvZGUnPjtcblxuICAgIC8qKlxuICAgICAqIEN1c3RvbSBidWlsZCBvcHRpb25zIGZvciBlc2J1aWxkIGJ1bmRsaW5nLlxuICAgICAqIE1lcmdlZCBpbiBwcmlvcml0eSBvcmRlcjogZGVmYXVsdHMgPCBjb25zdHJ1Y3QtbGV2ZWwgPCBkZWNvcmF0b3ItbGV2ZWxcbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHtcbiAgICAgKiAgIGJ1aWxkT3B0aW9uczoge1xuICAgICAqICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICogICAgIG1pbmlmeTogZmFsc2UsXG4gICAgICogICAgIGV4dGVybmFsOiBbJ0Bhd3Mtc2RrJywgJ0B0ZW4yNGdyb3VwL2Z3MjQnLCAnYXhpb3MnXSwgIC8vIERvbid0IGJ1bmRsZVxuICAgICAqICAgICBleHRlcm5hbFBhY2thZ2VzOiBbJ2F4aW9zJ10gICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBPbmx5IG5wbSBpbnN0YWxsIGF4aW9zXG4gICAgICogICB9XG4gICAgICogfVxuICAgICAqL1xuICAgIGJ1aWxkT3B0aW9ucz86IEV4dGVuZGVkQnVpbGRPcHRpb25zO1xuXG4gICAgLyoqXG4gICAgICogV2hldGhlciB0aGlzIGxheWVyIHNob3VsZCBOT1QgYmUgYWRkZWQgYXMgYSBnbG9iYWwgbGF5ZXIuXG4gICAgICogSWYgZmFsc2Ugb3IgdW5kZWZpbmVkLCB0aGUgbGF5ZXIgd2lsbCBiZSBhdXRvbWF0aWNhbGx5IGF0dGFjaGVkIHRvIGFsbCBMYW1iZGEgZnVuY3Rpb25zLlxuICAgICAqIERlZmF1bHRzIHRvIGZhbHNlIChsYXllciBJUyBnbG9iYWwpLlxuICAgICAqL1xuICAgIG5vdEdsb2JhbD86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIHRoaXMgbGF5ZXIgc2hvdWxkIGJlIGxvYWRlZCBhcyBhbiBlbnRyeSBwYWNrYWdlIChjb2RlIGV4ZWN1dGVzIGF0IG1vZHVsZSBpbml0aWFsaXphdGlvbikuXG4gICAgICogSWYgZmFsc2UsIHRoZSBsYXllciBpcyBvbmx5IGF2YWlsYWJsZSBmb3IgaW1wb3J0cyBidXQgZG9lc24ndCBleGVjdXRlLlxuICAgICAqIERlZmF1bHRzIHRvIGZhbHNlLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogLy8gZncyNCBydW50aW1lIGxheWVyIC0gYXZhaWxhYmxlIGZvciBpbXBvcnQgYnV0IGRvZXNuJ3QgZXhlY3V0ZVxuICAgICAqIHsgc291cmNlUGF0aDogJy4vZncyNC5qcycsIGlzRW50cnlQYWNrYWdlOiBmYWxzZSB9XG4gICAgICogXG4gICAgICogLy8gZGkgbGF5ZXIgLSBleGVjdXRlcyBESUNvbnRhaW5lci5ST09ULm1vZHVsZSgpIGF0IGluaXRcbiAgICAgKiB7IHNvdXJjZVBhdGg6ICcuL2RpLnRzJywgaXNFbnRyeVBhY2thZ2U6IHRydWUgfVxuICAgICAqL1xuICAgIGlzRW50cnlQYWNrYWdlPzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIFByaW9yaXR5IGZvciBsYXllciBsb2FkaW5nIG9yZGVyLiBMb3dlciBudW1iZXJzIGxvYWQgZmlyc3QuXG4gICAgICogSWYgbm90IHNwZWNpZmllZCwgcHJpb3JpdHkgaXMgYXV0by1hc3NpZ25lZCBhcyAoYXJyYXlfaW5kZXggKyAxMCkuXG4gICAgICogXG4gICAgICogUHJpb3JpdHkgcmFuZ2VzOlxuICAgICAqIC0gMC05OiBSZXNlcnZlZCBmb3IgZnJhbWV3b3JrIGxheWVycyAoZncyNCBjb3JlID0gMClcbiAgICAgKiAtIDEwKzogVXNlci9hcHBsaWNhdGlvbiBsYXllcnMgKGF1dG8tYXNzaWduZWQgb3IgZXhwbGljaXQpXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiAvLyBBdXRvLWFzc2lnbmVkIHByaW9yaXRpZXMgKHJlY29tbWVuZGVkKTpcbiAgICAgKiBjb25zdCBsYXllcnMgPSBuZXcgTGF5ZXJDb25zdHJ1Y3QoW1xuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9kaS50cycgfSwgICAgICAgIC8vIHByaW9yaXR5OiAxMFxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9zaGFyZWQudHMnIH0sICAgIC8vIHByaW9yaXR5OiAxMVxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9maXJlYmFzZS50cycgfSAgIC8vIHByaW9yaXR5OiAxMlxuICAgICAqIF0pO1xuICAgICAqIFxuICAgICAqIC8vIEV4cGxpY2l0IHByaW9yaXRpZXMgKGZvciBzcGVjaWFsIGNhc2VzKTpcbiAgICAgKiBjb25zdCBsYXllcnMgPSBuZXcgTGF5ZXJDb25zdHJ1Y3QoW1xuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9kaS50cycsIHByaW9yaXR5OiAxMCB9LCAgICAgIC8vIExvYWQgZmlyc3RcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vZmlyZWJhc2UudHMnLCBwcmlvcml0eTogMjAgfSwgLy8gTG9hZCBsYXN0XG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL3NoYXJlZC50cycsIHByaW9yaXR5OiAxNSB9ICAgLy8gTG9hZCBpbiBiZXR3ZWVuXG4gICAgICogXSk7XG4gICAgICovXG4gICAgcHJpb3JpdHk/OiBudW1iZXI7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIFBBQ0tBR0VfRElSRUNUT1JZIG1vZGUuXG4gKiBQYWNrYWdlcyBhIHByZS1idWlsdCBkaXJlY3RvcnkgYXMtaXMgd2l0aG91dCBidW5kbGluZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJUGFja2FnZURpcmVjdG9yeUNvbmZpZyBleHRlbmRzIElCYXNlTGF5ZXJDb25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBuYW1lIG9mIHRoZSBsYXllci5cbiAgICAgKi9cbiAgICBsYXllck5hbWU6IHN0cmluZztcbiAgICBcbiAgICAvKipcbiAgICAgKiBUaGUgbW9kZSBvZiBwYWNrYWdpbmc6IHBhY2thZ2UgdGhlIHdob2xlIGRpcmVjdG9yeS5cbiAgICAgKi9cbiAgICBtb2RlPzogJ1BBQ0tBR0VfRElSRUNUT1JZJztcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB0aGUgQlVJTERfQU5EX1BBQ0tBR0UgbW9kZS5cbiAqIEJ1bmRsZXMgc291cmNlIGZpbGVzIHdpdGggZXNidWlsZCBiZWZvcmUgcGFja2FnaW5nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElCdWlsZEFuZFBhY2thZ2VDb25maWcgZXh0ZW5kcyBJQmFzZUxheWVyQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgbW9kZSBvZiBwYWNrYWdpbmc6IHNjYW4gYW5kIGJ1aWxkIGluZGl2aWR1YWwgZmlsZXMuXG4gICAgICovXG4gICAgbW9kZTogJ0JVSUxEX0FORF9QQUNLQUdFJztcblxuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIGN1c3RvbSBkaXN0cmlidXRpb24gZGlyZWN0b3J5IGZvciB0aGUgYnVpbGQgb3V0cHV0cy5cbiAgICAgKi9cbiAgICBkaXN0RGlyZWN0b3J5Pzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogRmxhZyB0byBjbGVhciB0aGUgb3V0cHV0IGRpcmVjdG9yeSBhZnRlciBwYWNrYWdpbmc7IGRlZmF1bHRzIHRvIGZhbHNlLlxuICAgICAqL1xuICAgIGNsZWFyT3V0cHV0RGlyPzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyYWJsZSBvdXRwdXQgcGF0aCBmb3IgdGhlIHBhY2thZ2UuXG4gICAgICovIFxuICAgIHBhY2thZ2VQYXRoPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIGxheWVyIGNvbnN0cnVjdC5cbiAqIFxuICogTGF5ZXJzIGFyZSBwcm9jZXNzZWQgaW4gcGFyYWxsZWwgZm9yIHNwZWVkLCBidXQgbG9hZGVkIGF0IHJ1bnRpbWUgaW4gcHJpb3JpdHkgb3JkZXIuXG4gKiBQcmlvcml0eSBkZXRlcm1pbmVzIHRoZSBvcmRlciBpbiB3aGljaCBsYXllcnMgaW5pdGlhbGl6ZSB3aGVuIExhbWJkYSBjb2xkIHN0YXJ0cy5cbiAqIFxuICogQHNlZSBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnLnByaW9yaXR5IGZvciBwcmlvcml0eSBkZXRhaWxzXG4gKi9cbmV4cG9ydCB0eXBlIElMYXllckNvbnN0cnVjdENvbmZpZyA9IElQYWNrYWdlRGlyZWN0b3J5Q29uZmlnIHwgSUJ1aWxkQW5kUGFja2FnZUNvbmZpZztcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgY29uc3RydWN0IGZvciBjcmVhdGluZyBMYW1iZGEgbGF5ZXJzLlxuICogXG4gKiBMYXllcnMgYXJlIGJ1aWx0IGluIHBhcmFsbGVsIGZvciBwZXJmb3JtYW5jZSwgYnV0IGluaXRpYWxpemUgYXQgTGFtYmRhIHJ1bnRpbWVcbiAqIGluIHByaW9yaXR5IG9yZGVyLiBUaGlzIGVuc3VyZXMgY29ycmVjdCBkZXBlbmRlbmN5IGxvYWRpbmcgKGUuZy4sIERJIGNvbnRhaW5lclxuICogbG9hZHMgYmVmb3JlIGxheWVycyB0aGF0IHVzZSBpdCkuXG4gKiBcbiAqIFByaW9yaXR5IFN5c3RlbTpcbiAqIC0gMC05OiBSZXNlcnZlZCBmb3IgZnJhbWV3b3JrIGxheWVycyAoZncyNCBjb3JlID0gMClcbiAqIC0gMTArOiBBcHBsaWNhdGlvbiBsYXllcnMgKGF1dG8tYXNzaWduZWQgc3RhcnRpbmcgYXQgMTAsIG9yIHNldCBleHBsaWNpdGx5KVxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIEJhc2ljIHVzYWdlIHdpdGggYXV0by1wcmlvcml0eSAocmVjb21tZW5kZWQpXG4gKiBjb25zdCBkaUxheWVyID0gbmV3IERJTGF5ZXJDb25zdHJ1Y3QoW1xuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9kaS50cycgfSwgICAgICAgICAgICAgIC8vIHByaW9yaXR5OiAxMCAoYXV0bylcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvY29uZmlnL3NoYXJlZC50cycgfSwgICAvLyBwcmlvcml0eTogMTEgKGF1dG8pXG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2NvbmZpZy9maXJlYmFzZS50cycgfSAgLy8gcHJpb3JpdHk6IDEyIChhdXRvKVxuICogXSk7XG4gKiBcbiAqIC8vIEFkdmFuY2VkIHVzYWdlIHdpdGggZXhwbGljaXQgcHJpb3JpdGllc1xuICogY29uc3QgZGlMYXllciA9IG5ldyBESUxheWVyQ29uc3RydWN0KFtcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvZGkudHMnLCBwcmlvcml0eTogMTAgfSwgICAgICAgIC8vIExvYWQgZmlyc3RcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvY29uZmlnL2ZpcmViYXNlLnRzJywgcHJpb3JpdHk6IDIwIH0sIC8vIExvYWQgbGFzdFxuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9jb25maWcvc2hhcmVkLnRzJywgcHJpb3JpdHk6IDE1IH0gICAgLy8gTG9hZCBpbiBiZXR3ZWVuXG4gKiBdKTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgTGF5ZXJDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXI6IElMb2dnZXI7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICBcbiAgICBuYW1lID0gTGF5ZXJDb25zdHJ1Y3QubmFtZTtcbiAgICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gW107XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBMYXllckNvbnN0cnVjdCBpbnN0YW5jZS5cbiAgICAgKiBAcGFyYW0gY29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBMYXllckNvbnN0cnVjdC5cbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGNvbmZpZzogSUxheWVyQ29uc3RydWN0Q29uZmlnW10sIHZlcmJvc2VMb2cgPzogbnVtYmVyKSB7XG5cbiAgICAgICAgaWYodmVyYm9zZUxvZyl7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihMYXllckNvbnN0cnVjdC5uYW1lLCAxKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyID0gY3JlYXRlTG9nZ2VyKExheWVyQ29uc3RydWN0Lm5hbWUpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBhZGQgZGVmYXVsdHNcbiAgICAgICAgZm9yKGNvbnN0IGxheWVyQ29uZmlnIG9mIGNvbmZpZykge1xuICAgICAgICAgICAgbGF5ZXJDb25maWcubW9kZSA9IGxheWVyQ29uZmlnLm1vZGUgfHwgJ1BBQ0tBR0VfRElSRUNUT1JZJztcbiAgICAgICAgICAgIGlmIChsYXllckNvbmZpZy5tb2RlID09PSAnQlVJTERfQU5EX1BBQ0tBR0UnKSB7XG4gICAgICAgICAgICAgICAgbGF5ZXJDb25maWcuY2xlYXJPdXRwdXREaXIgPSBsYXllckNvbmZpZy5jbGVhck91dHB1dERpciA/PyBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKGNvbmZpZywgJ0xBWUVSJyk7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICAvLyBBc3NpZ24gcHJpb3JpdHkgdG8gZWFjaCBsYXllcjogdXNlIGV4cGxpY2l0IHByaW9yaXR5IGlmIHNldCwgb3RoZXJ3aXNlIHVzZSBhcnJheSBpbmRleCArIDEwXG4gICAgICAgIC8vIFByaW9yaXR5IDAtOSByZXNlcnZlZCBmb3IgZnJhbWV3b3JrIGxheWVycyAoZncyNCBjb3JlID0gMClcbiAgICAgICAgLy8gVXNlciBsYXllcnMgc3RhcnQgYXQgMTArIHRvIGVuc3VyZSBmcmFtZXdvcmsgbGF5ZXJzIGFsd2F5cyBsb2FkIGZpcnN0XG4gICAgICAgIGZvcihjb25zdCBbaW5kZXgsIGxheWVyQ29uZmlnXSBvZiB0aGlzLmNvbmZpZy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGlmICghbGF5ZXJDb25maWcucHJpb3JpdHkgJiYgbGF5ZXJDb25maWcucHJpb3JpdHkgIT09IDApIHtcbiAgICAgICAgICAgICAgICBsYXllckNvbmZpZy5wcmlvcml0eSA9IGluZGV4ICsgMTA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQcm9jZXNzIGxheWVycyBpbiBwYXJhbGxlbCBmb3Igc3BlZWQgd2hpbGUgcmVzcGVjdGluZyBwcmlvcml0eS1iYXNlZCBsb2FkaW5nIG9yZGVyXG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHRoaXMuY29uZmlnLm1hcChhc3luYyAobGF5ZXJDb25maWcpID0+IHtcbiAgICAgICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKGxheWVyQ29uZmlnLnN0YWNrTmFtZSB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkubGF5ZXJTdGFja05hbWUsIGxheWVyQ29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiUHJvY2Vzc2luZyBsYXllcjpcIiwgbGF5ZXJDb25maWcpO1xuXG4gICAgICAgICAgICBpZiAobGF5ZXJDb25maWcubW9kZSA9PT0gJ1BBQ0tBR0VfRElSRUNUT1JZJykge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGFja2FnZURpcmVjdG9yeShsYXllckNvbmZpZyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGxheWVyQ29uZmlnLm1vZGUgPT09ICdCVUlMRF9BTkRfUEFDS0FHRScpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNjYW5BbmRQYWNrYWdlRmlsZXMobGF5ZXJDb25maWcpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgbW9kZSBmb3IgbGF5ZXIgJHtKU09OLnN0cmluZ2lmeShsYXllckNvbmZpZyl9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQYWNrYWdlcyBhIGRpcmVjdG9yeSBhcyBhIExhbWJkYSBsYXllci5cbiAgICAgKiBAcGFyYW0gbGF5ZXJDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIGxheWVyLlxuICAgICAqIEBwYXJhbSBtYWluU3RhY2sgLSBUaGUgbWFpbiBzdGFjayBmb3IgZGVwbG95aW5nIHJlc291cmNlcy5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHBhY2thZ2VEaXJlY3RvcnkobGF5ZXJDb25maWc6IElQYWNrYWdlRGlyZWN0b3J5Q29uZmlnKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRMYXllclByb3BzOiBMYXllclZlcnNpb25Qcm9wcyA9IHtcbiAgICAgICAgICAgIGxheWVyVmVyc2lvbk5hbWU6IGxheWVyQ29uZmlnLmxheWVyTmFtZSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVSdW50aW1lczogWyBSdW50aW1lLk5PREVKU18yMl9YIF0sXG4gICAgICAgICAgICBjb2RlOiBDb2RlLmZyb21Bc3NldChsYXllckNvbmZpZy5zb3VyY2VQYXRoKSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVBcmNoaXRlY3R1cmVzOiBbQXJjaGl0ZWN0dXJlLkFSTV82NF0sXG4gICAgICAgIH07XG4gICAgICAgIFxuICAgICAgICBjb25zdCBsYXllciA9IG5ldyBMYXllclZlcnNpb24odGhpcy5tYWluU3RhY2ssIGxheWVyQ29uZmlnLmxheWVyTmFtZSArICctbGF5ZXInLCB7XG4gICAgICAgICAgICAuLi5kZWZhdWx0TGF5ZXJQcm9wcyxcbiAgICAgICAgICAgIC4uLmxheWVyQ29uZmlnLmxheWVyUHJvcHMsXG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBsYXllckNvbmZpZy5sYXllck5hbWUsIGxheWVyLCBPdXRwdXRUeXBlLkxBWUVSLCAnbGF5ZXJWZXJzaW9uQXJuJyk7XG5cbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFNjYW5zIGEgZGlyZWN0b3J5IGZvciBUeXBlU2NyaXB0IGZpbGVzIGFuZCBjcmVhdGVzIExhbWJkYSBsYXllcnMgZm9yIHRoZW0uXG4gICAgICogQHBhcmFtIGxheWVyQ29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBsYXllci5cbiAgICAgKiBAcGFyYW0gbWFpblN0YWNrIC0gVGhlIG1haW4gc3RhY2sgZm9yIGRlcGxveWluZyByZXNvdXJjZXMuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBzY2FuQW5kUGFja2FnZUZpbGVzKGxheWVyQ29uZmlnOiBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnKSB7XG4gICAgICAgIC8vIERlZmF1bHQgdG8gYXBwbGljYXRpb24ncyBkaXN0L2xheWVycyBkaXJlY3RvcnkgKHByb2Nlc3MuY3dkKCkgaXMgdGhlIGFwcGxpY2F0aW9uIHJvb3QpXG4gICAgICAgIGNvbnN0IGRpc3REaXJlY3RvcnkgPSBsYXllckNvbmZpZy5kaXN0RGlyZWN0b3J5IHx8IHBhdGhKb2luKHByb2Nlc3MuY3dkKCksICdkaXN0L2xheWVycycpO1xuICAgICAgICBjb25zdCBzb3VyY2VEaXJlY3RvcnlPckZpbGVOYW1lID0gcGF0aFJlc29sdmUobGF5ZXJDb25maWcuc291cmNlUGF0aCk7XG4gICAgICAgIGNvbnN0IHRzRmlsZXMgPSBsc3RhdFN5bmMoc291cmNlRGlyZWN0b3J5T3JGaWxlTmFtZSkuaXNEaXJlY3RvcnkoKVxuICAgICAgICAgICAgPyBzY2FuRGlyZWN0b3J5KHNvdXJjZURpcmVjdG9yeU9yRmlsZU5hbWUpXG4gICAgICAgICAgICA6IFtzb3VyY2VEaXJlY3RvcnlPckZpbGVOYW1lXTtcblxuICAgICAgICAvLyBQcm9jZXNzIGZpbGVzIGluIHBhcmFsbGVsIG5vdyB0aGF0IHdlIGhhdmUgcHJpb3JpdHktYmFzZWQgb3JkZXJpbmdcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwodHNGaWxlcy5tYXAoYXN5bmMgKGZpbGUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMudHJ5Q3JlYXRlTGF5ZXJGb3JGaWxlKGZpbGUsIGRpc3REaXJlY3RvcnksIGxheWVyQ29uZmlnKTtcbiAgICAgICAgfSkpO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogTWVyZ2VzIGJ1aWxkIG9wdGlvbnMgd2l0aCBwcm9wZXIgcHJpb3JpdHk6IGRlZmF1bHRzIDwgY29uc3RydWN0LWxldmVsIDwgZGVjb3JhdG9yLWxldmVsXG4gICAgICogQHBhcmFtIGxheWVyTmFtZSAtIExheWVyIG5hbWUgZm9yIGxvZ2dpbmdcbiAgICAgKiBAcGFyYW0gY29uc3RydWN0QnVpbGRPcHRpb25zIC0gQnVpbGQgb3B0aW9ucyBmcm9tIGNvbnN0cnVjdCBjb25maWdcbiAgICAgKiBAcGFyYW0gZGVjb3JhdG9yQnVpbGRPcHRpb25zIC0gQnVpbGQgb3B0aW9ucyBmcm9tIEBMYXllckVudHJ5IGRlY29yYXRvclxuICAgICAqIEByZXR1cm5zIE1lcmdlZCBidWlsZCBvcHRpb25zXG4gICAgICovXG4gICAgcHJpdmF0ZSBtZXJnZUJ1aWxkT3B0aW9ucyhcbiAgICAgICAgbGF5ZXJOYW1lOiBzdHJpbmcsXG4gICAgICAgIGNvbnN0cnVjdEJ1aWxkT3B0aW9ucz86IEV4dGVuZGVkQnVpbGRPcHRpb25zLFxuICAgICAgICBkZWNvcmF0b3JCdWlsZE9wdGlvbnM/OiBFeHRlbmRlZEJ1aWxkT3B0aW9uc1xuICAgICk6IEV4dGVuZGVkQnVpbGRPcHRpb25zIHtcbiAgICAgICAgLy8gRGVmYXVsdCBidWlsZCBvcHRpb25zIGZvciBhbGwgbGF5ZXJzXG4gICAgICAgIGNvbnN0IGRlZmF1bHRCdWlsZE9wdGlvbnM6IEJ1aWxkT3B0aW9ucyA9IHtcbiAgICAgICAgICAgIGJ1bmRsZTogdHJ1ZSxcbiAgICAgICAgICAgIHBsYXRmb3JtOiAnbm9kZScsXG4gICAgICAgICAgICB0YXJnZXQ6ICdub2RlMTgnLFxuICAgICAgICAgICAgbWluaWZ5OiBmYWxzZSxcbiAgICAgICAgICAgIHNvdXJjZW1hcDogZmFsc2UsXG4gICAgICAgICAgICBleHRlcm5hbDogW1xuICAgICAgICAgICAgICAgIC8vIEZyYW1ld29yayBydW50aW1lIHByb3ZpZGVkIGJ5IHNlcGFyYXRlIGZ3MjQgbGF5ZXJcbiAgICAgICAgICAgICAgICAnQHRlbjI0Z3JvdXAvZncyNCcsXG4gICAgICAgICAgICAgICAgLy8gQVdTIFNESyBhbmQgYnVpbGQgdG9vbHNcbiAgICAgICAgICAgICAgICAnQGF3cy1zZGsnLFxuICAgICAgICAgICAgICAgICdAc21pdGh5JyxcbiAgICAgICAgICAgICAgICAnYXdzLWNkay1saWInLFxuICAgICAgICAgICAgICAgICdlc2J1aWxkJyxcbiAgICAgICAgICAgIF1cbiAgICAgICAgfTtcblxuICAgICAgICAvLyBNZXJnZSBpbiBwcmlvcml0eSBvcmRlciB1c2luZyBkZWVwIG1lcmdlXG4gICAgICAgIGNvbnN0IG1lcmdlZCA9IChtZXJnZShbXG4gICAgICAgICAgICBkZWZhdWx0QnVpbGRPcHRpb25zLFxuICAgICAgICAgICAgY29uc3RydWN0QnVpbGRPcHRpb25zIHx8IHt9LFxuICAgICAgICAgICAgZGVjb3JhdG9yQnVpbGRPcHRpb25zIHx8IHt9XG4gICAgICAgIF0pID8/IGRlZmF1bHRCdWlsZE9wdGlvbnMpO1xuXG4gICAgICAgIC8vIExvZyBtZXJnZWQgY29uZmlndXJhdGlvblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgWyR7bGF5ZXJOYW1lfV0gQnVpbGQgb3B0aW9ucyBtZXJnZWQ6YCwge1xuICAgICAgICAgICAgc291cmNlbWFwOiBtZXJnZWQuc291cmNlbWFwLFxuICAgICAgICAgICAgbWluaWZ5OiBtZXJnZWQubWluaWZ5LFxuICAgICAgICAgICAgZXh0ZXJuYWw6IG1lcmdlZC5leHRlcm5hbCxcbiAgICAgICAgICAgIHBsYXRmb3JtOiBtZXJnZWQucGxhdGZvcm0sXG4gICAgICAgICAgICB0YXJnZXQ6IG1lcmdlZC50YXJnZXRcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIG1lcmdlZDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBBdHRlbXB0cyB0byBjcmVhdGUgYSBMYW1iZGEgbGF5ZXIgZm9yIGEgZ2l2ZW4gVHlwZVNjcmlwdCBmaWxlLlxuICAgICAqIEBwYXJhbSBmaWxlIC0gVGhlIHBhdGggdG8gdGhlIFR5cGVTY3JpcHQgZmlsZS5cbiAgICAgKiBAcGFyYW0gZGlzdERpcmVjdG9yeSAtIFRoZSBvdXRwdXQgZGlyZWN0b3J5IGZvciB0aGUgYnVpbGQuXG4gICAgICogQHBhcmFtIG1haW5TdGFjayAtIFRoZSBtYWluIHN0YWNrIGZvciBkZXBsb3lpbmcgcmVzb3VyY2VzLlxuICAgICAqIEBwYXJhbSBsYXllckNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgbGF5ZXIuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyB0cnlDcmVhdGVMYXllckZvckZpbGUoZmlsZTogc3RyaW5nLCBkaXN0RGlyZWN0b3J5OiBzdHJpbmcsIGxheWVyQ29uZmlnOiBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnKSB7XG4gICAgICAgIGNvbnN0IGZpbGVCYXNlTmFtZSA9IHBhdGhCYXNlTmFtZShmaWxlLCBwYXRoRXh0bmFtZShmaWxlKSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFByb2Nlc3NpbmcgbGF5ZXI6ICR7ZmlsZUJhc2VOYW1lfWApO1xuICAgICAgICBcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYExvYWRpbmcgbGF5ZXIgZGVzY3JpcHRvciBmcm9tICR7ZmlsZX0uLi5gKTtcbiAgICAgICAgY29uc3QgbW9kdWxlRXhwb3J0cyA9IGF3YWl0IGltcG9ydChmaWxlKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYExheWVyIGRlc2NyaXB0b3IgbG9hZGVkYCk7XG5cbiAgICAgICAgY29uc3QgZm91bmRMYXllckRlc2NyaXB0b3JOYW1lID0gT2JqZWN0LmtleXMobW9kdWxlRXhwb3J0cykuZmluZCgoa2V5KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBleHBvcnRlZCA9IG1vZHVsZUV4cG9ydHNba2V5XTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgZXhwb3J0ZWQgPT09ICdmdW5jdGlvbicgJiYgaXNMYXllckVudHJ5KGV4cG9ydGVkKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBleHBvcnRlZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gIFxuICAgICAgICBpZighZm91bmRMYXllckRlc2NyaXB0b3JOYW1lKXtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIExheWVyRW50cnkgZm91bmQgaW4gZmlsZSAke2ZpbGV9LiBXaWxsIHVzZSBEZWZhdWx0IG9wdGlvbnMuYCk7XG4gICAgICAgIH1cblxuICAgICAgICBMYXllckVudHJ5KHsgXG4gICAgICAgICAgICBub3RHbG9iYWw6IGxheWVyQ29uZmlnLm5vdEdsb2JhbCA/PyBmYWxzZSxcbiAgICAgICAgICAgIGlzRW50cnlQYWNrYWdlOiBsYXllckNvbmZpZy5pc0VudHJ5UGFja2FnZSA/PyBmYWxzZVxuICAgICAgICB9KVxuICAgICAgICBjbGFzcyBFbXB0eUxheWVyRGVzY3JpcHRvciB7fVxuXG4gICAgICAgIC8vIGlmIG5vIGxheWVyIGRlc2NyaXB0b3IgZm91bmQgaW4gdGhlIGZpbGUsIGNyZWF0ZSBhbiBlbXB0eSBjbGFzcyB3aGljaCB3aWxsIHVzZSBkZWZhdWx0IG9wdGlvbnNcbiAgICAgICAgY29uc3QgbGF5ZXJEZXNjcmlwdG9yID0gZm91bmRMYXllckRlc2NyaXB0b3JOYW1lID8gbW9kdWxlRXhwb3J0c1tmb3VuZExheWVyRGVzY3JpcHRvck5hbWVdIDogRW1wdHlMYXllckRlc2NyaXB0b3I7XG5cbiAgICAgICAgY29uc3QgbGF5ZXJOYW1lID0gZ2V0TGF5ZXJOYW1lKGxheWVyRGVzY3JpcHRvcikgfHwgZmlsZUJhc2VOYW1lO1xuICAgICAgICBcbiAgICAgICAgLy8gTWVyZ2UgYnVpbGQgb3B0aW9uczogZGVmYXVsdHMgPCBjb25zdHJ1Y3QtbGV2ZWwgPCBkZWNvcmF0b3ItbGV2ZWxcbiAgICAgICAgY29uc3QgZGVjb3JhdG9yQnVpbGRPcHRpb25zID0gZ2V0TGF5ZXJCdWlsZE9wdGlvbnMobGF5ZXJEZXNjcmlwdG9yKTtcbiAgICAgICAgY29uc3QgYnVpbGRPcHRpb25zID0gdGhpcy5tZXJnZUJ1aWxkT3B0aW9ucyhcbiAgICAgICAgICAgIGxheWVyTmFtZSxcbiAgICAgICAgICAgIGxheWVyQ29uZmlnLmJ1aWxkT3B0aW9ucyxcbiAgICAgICAgICAgIGRlY29yYXRvckJ1aWxkT3B0aW9uc1xuICAgICAgICApO1xuICAgICAgICBcbiAgICAgICAgLy8gRGV0ZXJtaW5lIHBhY2thZ2Ugc3RydWN0dXJlOlxuICAgICAgICAvLyAtIElmIHBhY2thZ2VQYXRoIGlzIHNldDogdXNlIGl0IGFzIHRoZSBmdWxsIG1vZHVsZSBwYXRoIChlLmcuLCBAdGVuMjRncm91cC9mdzI0KVxuICAgICAgICAvLyAtIElmIG5vdCBzZXQ6IHVzZSBmaWxlQmFzZU5hbWUgYXMgdGhlIHBhY2thZ2UgbmFtZSAoZS5nLiwgZGksIHNoYXJlZClcbiAgICAgICAgY29uc3QgcGFja2FnZU5hbWUgPSBsYXllckNvbmZpZy5wYWNrYWdlUGF0aCB8fCBmaWxlQmFzZU5hbWU7XG4gICAgICAgIGNvbnN0IGNvbmZpZ3VyZWRPdXRwdXRQYXRoID0gYG5vZGVqcy9ub2RlX21vZHVsZXMvJHtwYWNrYWdlTmFtZX1gO1xuICAgIFxuICAgICAgICBjb25zdCBvdXRwdXREaXIgPSBwYXRoSm9pbihkaXN0RGlyZWN0b3J5LCBsYXllck5hbWUsIGNvbmZpZ3VyZWRPdXRwdXRQYXRoKTtcbiAgICAgICAgY29uc3QgYnVuZGxlRGlyID0gcGF0aEpvaW4oZGlzdERpcmVjdG9yeSwgbGF5ZXJOYW1lKTtcblxuICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgLy8gQlVJTEQgTEFZRVI6IGVzYnVpbGQgKyBucG0gaW5zdGFsbCAod2l0aCBucG0gaW5zdGFsbCBjYWNoaW5nKVxuICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gQnVpbGRpbmcgbGF5ZXIuLi5gKTtcbiAgICAgICAgY29uc3QgYnVpbGRUaW1lciA9IFRpbWVyLnN0YXJ0KCk7XG5cbiAgICAgICAgLy8gRW5zdXJlIG91dHB1dCBkaXJlY3RvcnkgZXhpc3RzXG4gICAgICAgIGlmICghZXhpc3RzU3luYyhvdXRwdXREaXIpKSB7XG4gICAgICAgICAgICBta2RpclN5bmMob3V0cHV0RGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEluc3RhbGwgZXh0ZXJuYWwgZGVwZW5kZW5jaWVzIEZJUlNUICh3aXRoIHNtYXJ0IGNhY2hpbmcgdG8gc2tpcCBpZiB1bmNoYW5nZWQpXG4gICAgICAgIC8vIFVzZSBidWlsZE9wdGlvbnMuZXh0ZXJuYWxQYWNrYWdlcyBpZiBwcm92aWRlZCwgb3RoZXJ3aXNlIGZhbGwgYmFjayB0byBidWlsZE9wdGlvbnMuZXh0ZXJuYWwgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgICAgLy8gVGhpcyBhbGxvd3Mgc2VwYXJhdGluZyBwYWNrYWdlcyB0byBucG0gaW5zdGFsbCBmcm9tIHBhY2thZ2VzIHRvIG1hcmsgYXMgZXh0ZXJuYWwgaW4gZXNidWlsZFxuICAgICAgICBjb25zdCBleHRlcm5hbFBhY2thZ2VzID0gYnVpbGRPcHRpb25zLmV4dGVybmFsUGFja2FnZXMgXG4gICAgICAgICAgICA/IChBcnJheS5pc0FycmF5KGJ1aWxkT3B0aW9ucy5leHRlcm5hbFBhY2thZ2VzKSA/IGJ1aWxkT3B0aW9ucy5leHRlcm5hbFBhY2thZ2VzIDogW10pXG4gICAgICAgICAgICA6IChidWlsZE9wdGlvbnMuZXh0ZXJuYWwgJiYgQXJyYXkuaXNBcnJheShidWlsZE9wdGlvbnMuZXh0ZXJuYWwpKSA/IGJ1aWxkT3B0aW9ucy5leHRlcm5hbCA6IFtdO1xuICAgICAgICBcbiAgICAgICAgaWYgKGV4dGVybmFsUGFja2FnZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgY29uc3QgaW5zdGFsbFRpbWVyID0gVGltZXIuc3RhcnQoKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIFsxLzJdIEluc3RhbGxpbmcgZXh0ZXJuYWwgZGVwZW5kZW5jaWVzLi4uYCk7XG4gICAgICAgICAgICBhd2FpdCBpbnN0YWxsRXh0ZXJuYWxEZXBlbmRlbmNpZXNPcHRpbWl6ZWQoYnVuZGxlRGlyLCBleHRlcm5hbFBhY2thZ2VzLCB0aGlzLmxvZ2dlcik7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSAgICDinJMgRGVwZW5kZW5jaWVzIGluc3RhbGxlZCAoJHtpbnN0YWxsVGltZXIuZWxhcHNlZFNlY29uZHMoKX0pYCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUaGVuIGJ1bmRsZSBhcHBsaWNhdGlvbiBjb2RlIGludG8gbm9kZV9tb2R1bGVzXG4gICAgICAgIGNvbnN0IG91dHB1dEZpbGUgPSBwYXRoSm9pbihvdXRwdXREaXIsICdpbmRleC5qcycpO1xuICAgICAgICBjb25zdCBidW5kbGVUaW1lciA9IFRpbWVyLnN0YXJ0KCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIFsyLzJdIEJ1bmRsaW5nIHdpdGggZXNidWlsZC4uLmApO1xuICAgICAgICBhd2FpdCBidW5kbGVXaXRoRXNidWlsZChmaWxlLCBvdXRwdXRGaWxlLCBidWlsZE9wdGlvbnMpO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSAgICDinJMgQnVuZGxlIGNvbXBsZXRlICgke2J1bmRsZVRpbWVyLmVsYXBzZWRTZWNvbmRzKCl9KWApO1xuICAgICAgICBcbiAgICAgICAgLy8gQ3JlYXRlIHBhY2thZ2UuanNvbiBmb3IgTm9kZS5qcyBtb2R1bGUgcmVzb2x1dGlvblxuICAgICAgICAvLyBXaXRob3V0IHRoaXMsIHJlcXVpcmUoJ0BwYWNrYWdlL25hbWUnKSB3b24ndCB3b3JrIGV2ZW4gaWYgaW5kZXguanMgZXhpc3RzXG4gICAgICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHBhdGhKb2luKG91dHB1dERpciwgJ3BhY2thZ2UuanNvbicpO1xuICAgICAgICBjb25zdCBwYWNrYWdlSnNvbiA9IHtcbiAgICAgICAgICAgIG5hbWU6IHBhY2thZ2VOYW1lLFxuICAgICAgICAgICAgdmVyc2lvbjogXCIxLjAuMFwiLFxuICAgICAgICAgICAgbWFpbjogXCJpbmRleC5qc1wiLFxuICAgICAgICAgICAgdHlwZTogXCJjb21tb25qc1wiXG4gICAgICAgIH07XG4gICAgICAgIHdyaXRlRmlsZVN5bmMocGFja2FnZUpzb25QYXRoLCBKU09OLnN0cmluZ2lmeShwYWNrYWdlSnNvbiwgbnVsbCwgMikpO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSAgICDinJMgQ3JlYXRlZCBwYWNrYWdlLmpzb24gZm9yIG1vZHVsZSByZXNvbHV0aW9uYCk7XG4gICAgICAgIFxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSDinJMgQnVpbGQgY29tcGxldGUgaW4gJHtidWlsZFRpbWVyLmVsYXBzZWRTZWNvbmRzKCl9YClcblxuICAgICAgICAvLyBJbXBvcnQgcGF0aDogL29wdC9ub2RlanMvbm9kZV9tb2R1bGVzL3twYWNrYWdlTmFtZX0vaW5kZXguanNcbiAgICAgICAgLy8gTm9kZS5qcyB3aWxsIHJlc29sdmUgdGhpcyB0byB0aGUgYnVuZGxlZCBlbnRyeSBwb2ludFxuICAgICAgICBjb25zdCBsYXllckltcG9ydFBhdGggPSBwYXRoSm9pbignL29wdCcsIGNvbmZpZ3VyZWRPdXRwdXRQYXRoLCAnaW5kZXguanMnKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gTGF5ZXIgaW1wb3J0IHBhdGg6ICR7bGF5ZXJJbXBvcnRQYXRofWApO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGxheWVyTmFtZSwgbGF5ZXJJbXBvcnRQYXRoLCAnbGF5ZXJJbXBvcnRQYXRoJyk7XG5cbiAgICAgICAgaWYoaXNHbG9iYWxMYXllcihsYXllckRlc2NyaXB0b3IpKXtcbiAgICAgICAgICAgIC8vIEF0dGFjaCB0aGlzIGxheWVyIHRvIGFsbCBMYW1iZGEgZnVuY3Rpb25zXG4gICAgICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyhsYXllck5hbWUpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBPbmx5IGFkZCBhcyBlbnRyeSBwYWNrYWdlIGlmIGl0IG5lZWRzIHRvIGV4ZWN1dGUgYXQgbW9kdWxlIGluaXRpYWxpemF0aW9uXG4gICAgICAgICAgICBpZiAoaXNFbnRyeVBhY2thZ2UobGF5ZXJEZXNjcmlwdG9yKSkge1xuICAgICAgICAgICAgLy8gY29sbGVjdCBnbG9iYWwgZW50cnktcGFja2FnZXMgZm9yIGxhbWJkYXMgd2l0aCBwcmlvcml0eSBmb3IgY29ycmVjdCBsb2FkaW5nIG9yZGVyXG4gICAgICAgICAgICAvLyBQcmlvcml0eSBpcyBhbHdheXMgc2V0IGluIGNvbnN0cnVjdCgpLCBzbyBpdCBtdXN0IGJlIGRlZmluZWQgaGVyZVxuICAgICAgICAgICAgaWYgKGxheWVyQ29uZmlnLnByaW9yaXR5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYExheWVyICR7bGF5ZXJOYW1lfSBoYXMgbm8gcHJpb3JpdHkuIFRoaXMgc2hvdWxkIG5ldmVyIGhhcHBlbi5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuZncyNC5hZGRHbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2UoYGVudjpsYXllckltcG9ydFBhdGg6JHtsYXllck5hbWV9YCwgbGF5ZXJDb25maWcucHJpb3JpdHkpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIFJlZ2lzdGVyZWQgYXMgZW50cnkgcGFja2FnZSAocHJpb3JpdHk6ICR7bGF5ZXJDb25maWcucHJpb3JpdHl9KWApO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBMYXllciBhdHRhY2hlZCBidXQgTk9UIGFuIGVudHJ5IHBhY2thZ2UgKGF2YWlsYWJsZSBmb3IgaW1wb3J0IG9ubHkpYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYXllclByb3BzID0gZ2V0TGF5ZXJQcm9wcyhsYXllckRlc2NyaXB0b3IpO1xuXG4gICAgICAgIGNvbnN0IGRlZmF1bHRMYXllclByb3BzOiBMYXllclZlcnNpb25Qcm9wcyA9IHtcbiAgICAgICAgICAgIGxheWVyVmVyc2lvbk5hbWU6IGxheWVyTmFtZSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVSdW50aW1lczogWyBSdW50aW1lLk5PREVKU18yMl9YIF0sXG4gICAgICAgICAgICBjb2RlOiBDb2RlLmZyb21Bc3NldChidW5kbGVEaXIpLFxuICAgICAgICAgICAgY29tcGF0aWJsZUFyY2hpdGVjdHVyZXM6IFtBcmNoaXRlY3R1cmUuQVJNXzY0XSxcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBsYXllciA9IG5ldyBMYXllclZlcnNpb24odGhpcy5tYWluU3RhY2ssIGxheWVyTmFtZSArICctbGF5ZXInLCB7XG4gICAgICAgICAgICAuLi5kZWZhdWx0TGF5ZXJQcm9wcyxcbiAgICAgICAgICAgIC4uLmxheWVyQ29uZmlnLmxheWVyUHJvcHMsXG4gICAgICAgICAgICAuLi5sYXllclByb3BzLCAvLyB0aGUgbGF5ZXJQcm9wcyBmcm9tIHRoZSBkZWNvcmF0b3IgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgbGF5ZXJOYW1lLCBsYXllciwgT3V0cHV0VHlwZS5MQVlFUiwgJ2xheWVyVmVyc2lvbkFybicpO1xuXG4gICAgICAgIC8vIENsZWFuIHVwIHRoZSB0ZW1wb3Jhcnkgb3V0cHV0IGRpcmVjdG9yeSBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmIChsYXllckNvbmZpZy5jbGVhck91dHB1dERpcikge1xuICAgICAgICAgICAgY2xlYW51cERpcmVjdG9yeShvdXRwdXREaXIpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IHNjYW5zIGEgZGlyZWN0b3J5IGFuZCByZXR1cm5zIGEgbGlzdCBvZiBUeXBlU2NyaXB0IGZpbGVzLlxuICogQHBhcmFtIGRpcmVjdG9yeSAtIFRoZSBkaXJlY3RvcnkgdG8gc2Nhbi5cbiAqIEByZXR1cm5zIEFuIGFycmF5IG9mIFR5cGVTY3JpcHQgZmlsZSBwYXRocy5cbiAqL1xuZnVuY3Rpb24gc2NhbkRpcmVjdG9yeShkaXJlY3Rvcnk6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBsZXQgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgaXRlbXMgPSByZWFkZGlyU3luYyhkaXJlY3RvcnkpO1xuXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gcGF0aEpvaW4oZGlyZWN0b3J5LCBpdGVtKTtcbiAgICAgICAgY29uc3Qgc3RhdCA9IHN0YXRTeW5jKGZ1bGxQYXRoKTtcblxuICAgICAgICBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBmaWxlcyA9IGZpbGVzLmNvbmNhdChzY2FuRGlyZWN0b3J5KGZ1bGxQYXRoKSk7XG4gICAgICAgIH0gZWxzZSBpZiAoc3RhdC5pc0ZpbGUoKSAmJiBmdWxsUGF0aC5lbmRzV2l0aCgnLnRzJykpIHtcbiAgICAgICAgICAgIGZpbGVzLnB1c2goZnVsbFBhdGgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbGVzO1xufVxuXG5mdW5jdGlvbiBpc0xheWVyRW50cnkodGFyZ2V0OiBGdW5jdGlvbik6IGJvb2xlYW4ge1xuICAgIHJldHVybiAhIWdldExheWVyTmFtZSh0YXJnZXQpO1xufVxuXG5mdW5jdGlvbiBpc0dsb2JhbExheWVyKHRhcmdldDogRnVuY3Rpb24pOiBib29sZWFuIHtcbiAgICByZXR1cm4gIVJlZmxlY3QuZ2V0KHRhcmdldCwgJ25vdEdsb2JhbCcpO1xufVxuXG5mdW5jdGlvbiBpc0VudHJ5UGFja2FnZSh0YXJnZXQ6IEZ1bmN0aW9uKTogYm9vbGVhbiB7XG4gICAgY29uc3QgdmFsdWUgPSBSZWZsZWN0LmdldCh0YXJnZXQsICdpc0VudHJ5UGFja2FnZScpO1xuICAgIC8vIERlZmF1bHQgdG8gRkFMU0UgLSBsYXllcnMgYXJlIE5PVCBlbnRyeSBwYWNrYWdlcyB1bmxlc3MgZXhwbGljaXRseSBtYXJrZWRcbiAgICAvLyBFbnRyeSBwYWNrYWdlcyBleGVjdXRlIGNvZGUgYXQgTGFtYmRhIGluaXQ7IG1vc3QgbGF5ZXJzIGFyZSBqdXN0IHJ1bnRpbWUgbGlicmFyaWVzXG4gICAgcmV0dXJuIHZhbHVlID09PSB0cnVlO1xufVxuXG5mdW5jdGlvbiBnZXRMYXllck5hbWUodGFyZ2V0OiBGdW5jdGlvbikge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsICdsYXllck5hbWUnKTtcbn1cblxuZnVuY3Rpb24gZ2V0TGF5ZXJCdWlsZE9wdGlvbnModGFyZ2V0OiBGdW5jdGlvbik6IEJ1aWxkT3B0aW9ucyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRhcmdldCwgJ2J1aWxkT3B0aW9ucycpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGF5ZXJQcm9wcyh0YXJnZXQ6IEZ1bmN0aW9uKTogTGF5ZXJWZXJzaW9uUHJvcHMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsICdsYXllclByb3BzJyk7XG59XG5cbi8qKlxuICogQnVuZGxlcyBhIFR5cGVTY3JpcHQgZmlsZSB1c2luZyBlc2J1aWxkIHdpdGggdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBCdWlsZCBvcHRpb25zIHNob3VsZCBhbHJlYWR5IGJlIG1lcmdlZCB2aWEgbWVyZ2VCdWlsZE9wdGlvbnMoKS5cbiAqIEBwYXJhbSBlbnRyeUZpbGUgLSBUaGUgZW50cnkgZmlsZSB0byBidW5kbGUuXG4gKiBAcGFyYW0gb3V0cHV0RmlsZSAtIFRoZSBvdXRwdXQgZmlsZSBwYXRoIGZvciB0aGUgYnVuZGxlLlxuICogQHBhcmFtIGJ1aWxkT3B0aW9ucyAtIFByZS1tZXJnZWQgYnVpbGQgb3B0aW9ucyAobWF5IGluY2x1ZGUgY3VzdG9tIGZpZWxkcyBsaWtlIGV4dGVybmFsUGFja2FnZXMpLlxuICovXG5hc3luYyBmdW5jdGlvbiBidW5kbGVXaXRoRXNidWlsZChlbnRyeUZpbGU6IHN0cmluZywgb3V0cHV0RmlsZTogc3RyaW5nLCBidWlsZE9wdGlvbnM6IEV4dGVuZGVkQnVpbGRPcHRpb25zKSB7XG4gICAgLy8gU3RyaXAgb3V0IGN1c3RvbSBmaWVsZHMgdGhhdCBlc2J1aWxkIGRvZXNuJ3QgcmVjb2duaXplXG4gICAgY29uc3QgeyBleHRlcm5hbFBhY2thZ2VzOiBfZXh0ZXJuYWxQYWNrYWdlcywgLi4uZXNidWlsZE9wdGlvbnMgfSA9IGJ1aWxkT3B0aW9ucztcbiAgICBcbiAgICBjb25zdCBmaW5hbE9wdGlvbnM6IEJ1aWxkT3B0aW9ucyA9IHtcbiAgICAgICAgLi4uZXNidWlsZE9wdGlvbnMsXG4gICAgICAgIG91dGZpbGU6IG91dHB1dEZpbGUsXG4gICAgICAgIGVudHJ5UG9pbnRzOiBbZW50cnlGaWxlXSxcbiAgICB9O1xuXG4gICAgRGVmYXVsdExvZ2dlci5kZWJ1ZyhgYnVuZGxlV2l0aEVzYnVpbGQ6ICR7ZW50cnlGaWxlfSDihpIgJHtvdXRwdXRGaWxlfWApO1xuICAgIFxuICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGJ1aWxkKGZpbmFsT3B0aW9ucyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGJ1bmRsZSAke2VudHJ5RmlsZX06YCwgZXJyb3IpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGVzYnVpbGQgZmFpbGVkIGZvciAke2VudHJ5RmlsZX06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIH1cbn1cblxuLyoqXG4gKiBDYWxjdWxhdGVzIGhhc2ggb2YgYSBmaWxlJ3MgY29udGVudHNcbiAqL1xuZnVuY3Rpb24gY2FsY3VsYXRlRmlsZUhhc2goZmlsZVBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgY29udGVudCA9IHJlYWRGaWxlU3luYyhmaWxlUGF0aCk7XG4gICAgcmV0dXJuIGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShjb250ZW50KS5kaWdlc3QoJ2hleCcpO1xufVxuXG4vKipcbiAqIEhhc2hlcyBhIGRpcmVjdG9yeSdzIGNvbnRlbnRzIHJlY3Vyc2l2ZWx5IGZvciBjaGFuZ2UgZGV0ZWN0aW9uXG4gKiBVc2VkIGZvciBsb2NhbCBwYWNrYWdlIGRlcGVuZGVuY2llcyB0byBkZXRlY3Qgd2hlbiB0aGV5J3ZlIGJlZW4gcmVidWlsdFxuICogQHBhcmFtIGRpclBhdGggLSBEaXJlY3RvcnkgdG8gaGFzaCAodHlwaWNhbGx5IGEgZGlzdCBmb2xkZXIpXG4gKiBAcmV0dXJucyBTSEEtMjU2IGhhc2ggb2YgYWxsIGZpbGUgY29udGVudHNcbiAqL1xuLyoqXG4gKiBSZWN1cnNpdmVseSBoYXNoZXMgdGhlIGNvbnRlbnRzIG9mIGEgZGlyZWN0b3J5IGZvciBjaGFuZ2UgZGV0ZWN0aW9uLlxuICogU2tpcHMgY29tbW9uIG5vbi1ydW50aW1lIGRpcmVjdG9yaWVzIChub2RlX21vZHVsZXMsIC5naXQsIHRlc3QsIGV0Yy4pXG4gKiBSZXR1cm5zIGNvbnNpc3RlbnQgU0hBLTI1NiBoYXNoIGV2ZW4gZm9yIGVtcHR5IGRpcmVjdG9yaWVzLlxuICogXG4gKiBAcGFyYW0gZGlyUGF0aCAtIEFic29sdXRlIHBhdGggdG8gZGlyZWN0b3J5IHRvIGhhc2hcbiAqIEByZXR1cm5zIFNIQS0yNTYgaGFzaCAoNjQgaGV4IGNoYXJhY3RlcnMpXG4gKi9cbmZ1bmN0aW9uIGhhc2hEaXJlY3RvcnlDb250ZW50cyhkaXJQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGhhc2ggPSBjcmVhdGVIYXNoKCdzaGEyNTYnKTtcbiAgICBsZXQgZmlsZUNvdW50ID0gMDtcbiAgICBcbiAgICBjb25zdCBoYXNoRGlyUmVjdXJzaXZlID0gKGN1cnJlbnRQYXRoOiBzdHJpbmcpID0+IHtcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKGN1cnJlbnRQYXRoKSkgcmV0dXJuO1xuICAgICAgICBcbiAgICAgICAgY29uc3Qgc3RhdCA9IGxzdGF0U3luYyhjdXJyZW50UGF0aCk7XG4gICAgICAgIFxuICAgICAgICBpZiAoc3RhdC5pc1N5bWJvbGljTGluaygpKSB7XG4gICAgICAgICAgICAvLyBTa2lwIHN5bWxpbmtzIHRvIGF2b2lkIGluZmluaXRlIGxvb3BzIGFuZCBpbmNvbnNpc3RlbnQgYmVoYXZpb3JcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHN0YXQuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgICAgY29uc3QgaXRlbXMgPSByZWFkZGlyU3luYyhjdXJyZW50UGF0aCkuc29ydCgoYSwgYikgPT4gYS5sb2NhbGVDb21wYXJlKGIpKTsgLy8gU29ydCBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nXG4gICAgICAgICAgICBmb3IoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgICAgICAgICAgICAgIC8vIFNraXAgY29tbW9uIGRpcmVjdG9yaWVzIHRoYXQgZG9uJ3QgYWZmZWN0IHJ1bnRpbWVcbiAgICAgICAgICAgICAgICBpZiAoaXRlbSA9PT0gJ25vZGVfbW9kdWxlcycgfHwgaXRlbSA9PT0gJy5naXQnIHx8IFxuICAgICAgICAgICAgICAgICAgICBpdGVtID09PSAndGVzdCcgfHwgaXRlbSA9PT0gJ19fdGVzdHNfXycgfHwgXG4gICAgICAgICAgICAgICAgICAgIGl0ZW0gPT09ICdjb3ZlcmFnZScgfHwgaXRlbSA9PT0gJy5EU19TdG9yZScpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBoYXNoRGlyUmVjdXJzaXZlKHBhdGhKb2luKGN1cnJlbnRQYXRoLCBpdGVtKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoc3RhdC5pc0ZpbGUoKSkge1xuICAgICAgICAgICAgZmlsZUNvdW50Kys7XG4gICAgICAgICAgICAvLyBIYXNoIGZpbGUgcGF0aCAocmVsYXRpdmUpIGZvciB1bmlxdWVuZXNzXG4gICAgICAgICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBwYXRoUmVsYXRpdmUoZGlyUGF0aCwgY3VycmVudFBhdGgpO1xuICAgICAgICAgICAgaGFzaC51cGRhdGUocmVsYXRpdmVQYXRoKTtcbiAgICAgICAgICAgIC8vIEhhc2ggZmlsZSBjb250ZW50c1xuICAgICAgICAgICAgaGFzaC51cGRhdGUocmVhZEZpbGVTeW5jKGN1cnJlbnRQYXRoKSk7XG4gICAgICAgIH1cbiAgICB9O1xuICAgIFxuICAgIC8vIEhhc2ggdGhlIGRpcmVjdG9yeSBwYXRoIGl0c2VsZiBmaXJzdCBmb3IgdW5pcXVlbmVzc1xuICAgIGhhc2gudXBkYXRlKGRpclBhdGgpO1xuICAgIGhhc2hEaXJSZWN1cnNpdmUoZGlyUGF0aCk7XG4gICAgXG4gICAgLy8gSWYgbm8gZmlsZXMgd2VyZSBmb3VuZCwgdXBkYXRlIGhhc2ggd2l0aCBzZW50aW5lbCB2YWx1ZVxuICAgIC8vIFRoaXMgZW5zdXJlcyBlbXB0eSBkaXJlY3RvcmllcyBoYXZlIGEgZGlmZmVyZW50IGhhc2ggdGhhbiBub24tZXhpc3RlbnQgb25lc1xuICAgIGlmIChmaWxlQ291bnQgPT09IDApIHtcbiAgICAgICAgaGFzaC51cGRhdGUoJ19fRU1QVFlfRElSRUNUT1JZX18nKTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGhhc2guZGlnZXN0KCdoZXgnKTtcbn1cblxuXG4vKipcbiAqIENsZWFucyB1cCBhIHRlbXBvcmFyeSBkaXJlY3RvcnkgYnkgcmVtb3ZpbmcgYWxsIGZpbGVzIGFuZCBzdWJkaXJlY3Rvcmllcy5cbiAqIEBwYXJhbSBkaXJlY3RvcnkgLSBUaGUgZGlyZWN0b3J5IHRvIGNsZWFuIHVwLlxuICovXG5mdW5jdGlvbiBjbGVhbnVwRGlyZWN0b3J5KGRpcmVjdG9yeTogc3RyaW5nKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgcm1TeW5jKGRpcmVjdG9yeSwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYGJ1bmRsZVdpdGhFc2J1aWxkOiBDbGVhbmVkIHVwIHRlbXBvcmFyeSBkaXJlY3Rvcnk6ICR7ZGlyZWN0b3J5fWApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuZXJyb3IoYGJ1bmRsZVdpdGhFc2J1aWxkOiBGYWlsZWQgdG8gY2xlYW4gdXAgZGlyZWN0b3J5ICR7ZGlyZWN0b3J5fTpgLCBlcnJvcik7XG4gICAgfVxufVxuXG4vKipcbiAqIE9QVElNSVpFRDogSW5zdGFsbHMgZXh0ZXJuYWwgZGVwZW5kZW5jaWVzIHdpdGggaW50ZWxsaWdlbnQgY2FjaGluZ1xuICogXG4gKiBAcGFyYW0gbGF5ZXJPdXRwdXREaXIgLSBUaGUgT1VUUFVUIGRpcmVjdG9yeSBmb3IgdGhlIGxheWVyIChlLmcuLCBkaXN0L2xheWVycy9kaSlcbiAqIEBwYXJhbSBleHRlcm5hbFBhY2thZ2VzIC0gQXJyYXkgb2YgcGFja2FnZSBuYW1lcyB0byBpbnN0YWxsIChlLmcuLCBbJ2F4aW9zJywgJ2ZpcmViYXNlLWFkbWluJ10pXG4gKiBAcGFyYW0gbG9nZ2VyIC0gTG9nZ2VyIGluc3RhbmNlIGZvciBvdXRwdXRcbiAqL1xuYXN5bmMgZnVuY3Rpb24gaW5zdGFsbEV4dGVybmFsRGVwZW5kZW5jaWVzT3B0aW1pemVkKGxheWVyT3V0cHV0RGlyOiBzdHJpbmcsIGV4dGVybmFsUGFja2FnZXM6IChzdHJpbmcgfCBSZWdFeHApW10sIGxvZ2dlcjogYW55KSB7XG4gICAgLy8gRmlsdGVyIG91dCByZWdleCBwYXR0ZXJucywgZnJhbWV3b3JrIHBhY2thZ2VzLCBhbmQgcGFja2FnZXMgcHJvdmlkZWQgYnkgb3RoZXIgbGF5ZXJzXG4gICAgY29uc3QgcGFja2FnZU5hbWVzID0gZXh0ZXJuYWxQYWNrYWdlcy5maWx0ZXIocGtnID0+IFxuICAgICAgICB0eXBlb2YgcGtnID09PSAnc3RyaW5nJyAmJiBcbiAgICAgICAgIXBrZy5zdGFydHNXaXRoKCdAYXdzLXNkaycpICYmICAgICAgLy8gUHJvdmlkZWQgYnkgTGFtYmRhIHJ1bnRpbWVcbiAgICAgICAgIXBrZy5zdGFydHNXaXRoKCdAc21pdGh5JykgJiYgICAgICAgLy8gUHJvdmlkZWQgYnkgTGFtYmRhIHJ1bnRpbWVcbiAgICAgICAgIXBrZy5zdGFydHNXaXRoKCdhd3MtY2RrLWxpYicpICYmICAgLy8gQnVpbGQtdGltZSBvbmx5XG4gICAgICAgIHBrZyAhPT0gJ2VzYnVpbGQnICYmICAgICAgICAgICAgICAgIC8vIEJ1aWxkLXRpbWUgb25seVxuICAgICAgICBwa2cgIT09ICdAdGVuMjRncm91cC9mdzI0JyAgICAgICAgICAvLyBQcm92aWRlZCBieSBmdzI0IHJ1bnRpbWUgbGF5ZXIgKG5vdCBkaSBsYXllcilcbiAgICApIGFzIHN0cmluZ1tdO1xuXG4gICAgaWYgKHBhY2thZ2VOYW1lcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IG5vZGVqc0RpciA9IHBhdGhKb2luKGxheWVyT3V0cHV0RGlyLCAnbm9kZWpzJyk7XG4gICAgY29uc3Qgbm9kZU1vZHVsZXNEaXIgPSBwYXRoSm9pbihub2RlanNEaXIsICdub2RlX21vZHVsZXMnKTtcbiAgICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSBwYXRoSm9pbihub2RlanNEaXIsICdwYWNrYWdlLmpzb24nKTtcbiAgICBjb25zdCBwYWNrYWdlSGFzaFBhdGggPSBwYXRoSm9pbihub2RlanNEaXIsICcucGFja2FnZS1oYXNoJyk7XG4gICAgXG4gICAgLy8gQnVpbGQgZGVzaXJlZCBwYWNrYWdlLmpzb25cbiAgICBjb25zdCBwYWNrYWdlSnNvbjogYW55ID0ge1xuICAgICAgICBuYW1lOiAnbGF5ZXItZGVwZW5kZW5jaWVzJyxcbiAgICAgICAgdmVyc2lvbjogJzEuMC4wJyxcbiAgICAgICAgZGVwZW5kZW5jaWVzOiB7fVxuICAgIH07XG5cbiAgICAvLyBSZWFkIHRoZSBwcm9qZWN0J3MgcGFja2FnZS5qc29uIHRvIGdldCB2ZXJzaW9uIG51bWJlcnNcbiAgICBjb25zdCBwcm9qZWN0Um9vdCA9IHBhdGhSZXNvbHZlKHByb2Nlc3MuY3dkKCkpO1xuICAgIGNvbnN0IHByb2plY3RQYWNrYWdlSnNvblBhdGggPSBwYXRoSm9pbihwcm9qZWN0Um9vdCwgJ3BhY2thZ2UuanNvbicpO1xuICAgIFxuICAgIC8vIFRyYWNrIGxvY2FsIHBhY2thZ2UgY29udGVudCBoYXNoZXMgZm9yIGNoYW5nZSBkZXRlY3Rpb25cbiAgICBjb25zdCBsb2NhbFBhY2thZ2VIYXNoZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgICBcbiAgICBpZiAoIWV4aXN0c1N5bmMocHJvamVjdFBhY2thZ2VKc29uUGF0aCkpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oYHBhY2thZ2UuanNvbiBub3QgZm91bmQgYXQgJHtwcm9qZWN0UGFja2FnZUpzb25QYXRofSwgaW5zdGFsbGluZyBsYXRlc3QgdmVyc2lvbnNgKTtcbiAgICAgICAgZm9yKGNvbnN0IHBrZyBvZiBwYWNrYWdlTmFtZXMpIHtcbiAgICAgICAgICAgIHBhY2thZ2VKc29uLmRlcGVuZGVuY2llc1twa2ddID0gJ2xhdGVzdCc7XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBwcm9qZWN0UGFja2FnZUpzb24gPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhwcm9qZWN0UGFja2FnZUpzb25QYXRoLCAndXRmLTgnKSk7XG4gICAgICAgIC8vIE9OTFkgdXNlIHJ1bnRpbWUgZGVwZW5kZW5jaWVzIC0gZGV2RGVwZW5kZW5jaWVzIGFyZSBidWlsZC10aW1lIHRvb2xzLCBub3QgTGFtYmRhIHJ1bnRpbWUhXG4gICAgICAgIGNvbnN0IHJ1bnRpbWVEZXBzID0gcHJvamVjdFBhY2thZ2VKc29uLmRlcGVuZGVuY2llcyB8fCB7fTtcblxuICAgICAgICBmb3IoY29uc3QgcGtnIG9mIHBhY2thZ2VOYW1lcykge1xuICAgICAgICAgICAgaWYgKHJ1bnRpbWVEZXBzW3BrZ10pIHtcbiAgICAgICAgICAgICAgICBsZXQgZGVwVmFsdWUgPSBydW50aW1lRGVwc1twa2ddO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIEhhbmRsZSBsb2NhbCBmaWxlc3lzdGVtIGRlcGVuZGVuY2llcyAoZS5nLiwgXCIuLi9mdzI0L1wiLCBcImZpbGU6Li4vZncyNFwiLCBvciBcIi4uXFxmdzI0XCIgb24gV2luZG93cylcbiAgICAgICAgICAgICAgICBjb25zdCBpc0xvY2FsRGVwID0gZGVwVmFsdWUuc3RhcnRzV2l0aCgnZmlsZTonKSB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlcFZhbHVlLnN0YXJ0c1dpdGgoJy4uLycpIHx8IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVwVmFsdWUuc3RhcnRzV2l0aCgnLi8nKSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVwVmFsdWUuc3RhcnRzV2l0aCgnLi5cXFxcJykgfHwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXBWYWx1ZS5zdGFydHNXaXRoKCcuXFxcXCcpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChpc0xvY2FsRGVwKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxvY2FsUGF0aCA9IGRlcFZhbHVlLnJlcGxhY2UoJ2ZpbGU6JywgJycpO1xuICAgICAgICAgICAgICAgICAgICAvLyBSZXNvbHZlIGFic29sdXRlIHBhdGggb2YgdGhlIGxvY2FsIHBhY2thZ2VcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcGF0aFJlc29sdmUocHJvamVjdFJvb3QsIGxvY2FsUGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyBWYWxpZGF0ZSBsb2NhbCBwYWNrYWdlIGV4aXN0c1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoYWJzb2x1dGVQYXRoKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNc2cgPSBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYOKdjCBMb2NhbCBwYWNrYWdlIFwiJHtwa2d9XCIgcGF0aCBkb2VzIG5vdCBleGlzdDogJHthYnNvbHV0ZVBhdGh9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAgU3BlY2lmaWVkIGluIHBhY2thZ2UuanNvbiBhczogJHtkZXBWYWx1ZX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICBSZXNvbHZlZCBmcm9tIHByb2plY3Qgcm9vdDogJHtwcm9qZWN0Um9vdH1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICBQbGVhc2UgZW5zdXJlIHRoZSBsb2NhbCBwYWNrYWdlIHBhdGggaXMgY29ycmVjdC5gXG4gICAgICAgICAgICAgICAgICAgICAgICBdLmpvaW4oJ1xcbicpO1xuICAgICAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGVycm9yTXNnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTG9jYWwgcGFja2FnZSBwYXRoIG5vdCBmb3VuZDogJHtwa2d9IC0+ICR7YWJzb2x1dGVQYXRofWApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyBDUklUSUNBTDogVmFsaWRhdGUgdGhhdCBsb2NhbCBwYWNrYWdlIGlzIGJ1aWx0IChoYXMgZGlzdCBmb2xkZXIpXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpc3RQYXRoID0gcGF0aEpvaW4oYWJzb2x1dGVQYXRoLCAnZGlzdCcpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZGlzdFBhdGgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlcnJvck1zZyA9IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBg4p2MIExvY2FsIHBhY2thZ2UgXCIke3BrZ31cIiBoYXMgbm8gZGlzdCBmb2xkZXI6ICR7ZGlzdFBhdGh9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAgTG9jYWwgcGFja2FnZXMgTVVTVCBiZSBidWlsdCBiZWZvcmUgYmVpbmcgdXNlZCBhcyBkZXBlbmRlbmNpZXMuYCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAgUGxlYXNlIHJ1biB0aGUgYnVpbGQgY29tbWFuZCBpbjogJHthYnNvbHV0ZVBhdGh9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAgRXhhbXBsZTogY2QgJHthYnNvbHV0ZVBhdGh9ICYmIG5wbSBydW4gYnVpbGRgXG4gICAgICAgICAgICAgICAgICAgICAgICBdLmpvaW4oJ1xcbicpO1xuICAgICAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGVycm9yTXNnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTG9jYWwgcGFja2FnZSBub3QgYnVpbHQ6ICR7cGtnfSAobWlzc2luZyBkaXN0IGZvbGRlcilgKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gSGFzaCB0aGUgZGlzdCBmb2xkZXIgY29udGVudHMgZm9yIGNoYW5nZSBkZXRlY3Rpb25cbiAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKGkiBIYXNoaW5nIGxvY2FsIHBhY2thZ2UgXCIke3BrZ31cIiBkaXN0IGZvbGRlci4uLmApO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb250ZW50SGFzaCA9IGhhc2hEaXJlY3RvcnlDb250ZW50cyhkaXN0UGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyBWYWxpZGF0ZSBoYXNoIGlzIG5vbi1lbXB0eSAoZGlzdCBmb2xkZXIgaGFzIGFjdHVhbCBmaWxlcylcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbnRlbnRIYXNoPy5sZW5ndGggIT09IDY0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgICAg4pqg77iPICBVbmV4cGVjdGVkIGhhc2ggZm9yIFwiJHtwa2d9XCI6ICR7Y29udGVudEhhc2h9YCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGxvY2FsUGFja2FnZUhhc2hlc1twa2ddID0gY29udGVudEhhc2g7XG4gICAgICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGAgICDihpIgTG9jYWwgcGFja2FnZSBcIiR7cGtnfVwiIGhhc2g6ICR7Y29udGVudEhhc2guc3Vic3RyaW5nKDAsIDEyKX0uLi4gKCR7cGtnfSlgKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIENhbGN1bGF0ZSByZWxhdGl2ZSBwYXRoIGZyb20gbGF5ZXIncyBub2RlanMgZGlyIHRvIGxvY2FsIHBhY2thZ2VcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVsYXRpdmVQYXRoRnJvbUxheWVyID0gcGF0aFJlbGF0aXZlKG5vZGVqc0RpciwgYWJzb2x1dGVQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgZGVwVmFsdWUgPSByZWxhdGl2ZVBhdGhGcm9tTGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGAgICDihpIgUmVzb2x2ZWQgbG9jYWwgcGFja2FnZSBcIiR7cGtnfVwiOiAke3JlbGF0aXZlUGF0aEZyb21MYXllcn1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcGFja2FnZUpzb24uZGVwZW5kZW5jaWVzW3BrZ10gPSBkZXBWYWx1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gUGFja2FnZSBub3QgZm91bmQgaW4gZGVwZW5kZW5jaWVzIC0gdGhpcyBpcyBhIGNvbmZpZ3VyYXRpb24gZXJyb3JcbiAgICAgICAgICAgICAgICBjb25zdCBlcnJvck1zZyA9IFtcbiAgICAgICAgICAgICAgICAgICAgYOKdjCBQYWNrYWdlIFwiJHtwa2d9XCIgbm90IGZvdW5kIGluIHJ1bnRpbWUgZGVwZW5kZW5jaWVzLmAsXG4gICAgICAgICAgICAgICAgICAgIGAgICBUaGlzIHBhY2thZ2UgaXMgbWFya2VkIGFzICdleHRlcm5hbCcgaW4gdGhlIGxheWVyIGJ1aWxkIGJ1dCBpcyBub3QgaW4gcGFja2FnZS5qc29uIGRlcGVuZGVuY2llcy5gLFxuICAgICAgICAgICAgICAgICAgICBgICAgQWRkIFwiJHtwa2d9XCIgdG8gZGVwZW5kZW5jaWVzIGluIHBhY2thZ2UuanNvbiB3aXRoIGEgc3BlY2lmaWMgdmVyc2lvbi5gLFxuICAgICAgICAgICAgICAgICAgICBgICAgRXhhbXBsZTogbnBtIGluc3RhbGwgJHtwa2d9IC0tc2F2ZWAsXG4gICAgICAgICAgICAgICAgICAgIGAgICBUaGVuIHJlYnVpbGQgdGhlIGxheWVyLmBcbiAgICAgICAgICAgICAgICBdLmpvaW4oJ1xcbicpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGxvZ2dlci5lcnJvcihlcnJvck1zZyk7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHJ1bnRpbWUgZGVwZW5kZW5jeTogJHtwa2d9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgY29uc3QgcGFja2FnZUpzb25Db250ZW50ID0gSlNPTi5zdHJpbmdpZnkocGFja2FnZUpzb24sIG51bGwsIDIpO1xuICAgIGNvbnN0IGhhc2ggPSBjcmVhdGVIYXNoKCdzaGEyNTYnKTtcbiAgICBoYXNoLnVwZGF0ZShwYWNrYWdlSnNvbkNvbnRlbnQpO1xuICAgIFxuICAgIC8vIENSSVRJQ0FMOiBJbmNsdWRlIGxvY2FsIHBhY2thZ2UgY29udGVudCBoYXNoZXMgaW4gdGhlIGNhY2hlIGtleVxuICAgIC8vIFRoaXMgZW5zdXJlcyB3ZSByZWluc3RhbGwgd2hlbiBsb2NhbCBwYWNrYWdlcyBjaGFuZ2UgKGUuZy4sIGZ3MjQgdXBkYXRlcylcbiAgICBpZiAoT2JqZWN0LmtleXMobG9jYWxQYWNrYWdlSGFzaGVzKS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgICAg4oaSIEluY2x1ZGluZyAke09iamVjdC5rZXlzKGxvY2FsUGFja2FnZUhhc2hlcykubGVuZ3RofSBsb2NhbCBwYWNrYWdlIGNvbnRlbnQgaGFzaGVzIGluIGNhY2hlIGtleWApO1xuICAgICAgICBmb3IoY29uc3QgcGtnIG9mIE9iamVjdC5rZXlzKGxvY2FsUGFja2FnZUhhc2hlcykuc29ydCgoYSwgYikgPT4gYS5sb2NhbGVDb21wYXJlKGIpKSkge1xuICAgICAgICAgICAgaGFzaC51cGRhdGUoYCR7cGtnfToke2xvY2FsUGFja2FnZUhhc2hlc1twa2ddfWApO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIGNvbnN0IGN1cnJlbnRQYWNrYWdlSGFzaCA9IGhhc2guZGlnZXN0KCdoZXgnKTtcbiAgICBcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvLyBGQVNUIFBBVEg6IENoZWNrIGlmIHdlIGNhbiBza2lwIG5wbSBpbnN0YWxsXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgbGV0IHNraXBSZWFzb246IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgIGlmICghZXhpc3RzU3luYyhwYWNrYWdlSGFzaFBhdGgpKSB7XG4gICAgICAgIHNraXBSZWFzb24gPSAnTm8gcHJldmlvdXMgaGFzaCBmaWxlIGZvdW5kIChmaXJzdCBidWlsZCknO1xuICAgIH0gZWxzZSBpZiAoIWV4aXN0c1N5bmMobm9kZU1vZHVsZXNEaXIpKSB7XG4gICAgICAgIHNraXBSZWFzb24gPSAnbm9kZV9tb2R1bGVzIGRpcmVjdG9yeSBub3QgZm91bmQnO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBwcmV2aW91c0hhc2ggPSByZWFkRmlsZVN5bmMocGFja2FnZUhhc2hQYXRoLCAndXRmLTgnKS50cmltKCk7XG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSBoYXNoIGZvcm1hdCAoU0hBLTI1NiA9IDY0IGhleCBjaGFycylcbiAgICAgICAgICAgIGlmIChwcmV2aW91c0hhc2gubGVuZ3RoICE9PSA2NCB8fCAhL15bMC05YS1mXXs2NH0kLy50ZXN0KHByZXZpb3VzSGFzaCkpIHtcbiAgICAgICAgICAgICAgICBza2lwUmVhc29uID0gYEludmFsaWQgaGFzaCBmb3JtYXQgaW4gY2FjaGUgZmlsZSAoZ290ICR7cHJldmlvdXNIYXNoLmxlbmd0aH0gY2hhcnMpYDtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAocHJldmlvdXNIYXNoID09PSBjdXJyZW50UGFja2FnZUhhc2gpIHtcbiAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4pyTIERlcGVuZGVuY2llcyB1bmNoYW5nZWQsIHNraXBwaW5nIG5wbSBpbnN0YWxsIChzYXZlZCB+MTFzKWApO1xuICAgICAgICAgICAgICAgIHJldHVybjsgLy8gRkFTVCBQQVRIIFNVQ0NFU1MhXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNraXBSZWFzb24gPSAnRGVwZW5kZW5jeSBjaGFuZ2VzIGRldGVjdGVkJztcbiAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4oaSIFByZXZpb3VzIGhhc2g6ICR7cHJldmlvdXNIYXNoLnN1YnN0cmluZygwLCAxMil9Li4uYCk7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKGkiBDdXJyZW50IGhhc2g6ICAke2N1cnJlbnRQYWNrYWdlSGFzaC5zdWJzdHJpbmcoMCwgMTIpfS4uLmApO1xuICAgICAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhsb2NhbFBhY2thZ2VIYXNoZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKGkiBMb2NhbCBwYWNrYWdlcyBpbmNsdWRlZCBpbiBoYXNoOiAke09iamVjdC5rZXlzKGxvY2FsUGFja2FnZUhhc2hlcykuam9pbignLCAnKX1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHNraXBSZWFzb24gPSBgRmFpbGVkIHRvIHJlYWQgaGFzaCBmaWxlOiAke2Vycm9yLm1lc3NhZ2V9YDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvLyBTTE9XIFBBVEg6IE5lZWQgdG8gcnVuIG5wbSBpbnN0YWxsXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgbG9nZ2VyLmluZm8oYCAgIPCfk6YgUnVubmluZyBucG0gaW5zdGFsbCAocmVhc29uOiAke3NraXBSZWFzb259KWApO1xuICAgIGxvZ2dlci5pbmZvKGAgICDihpIgSW5zdGFsbGluZyAke3BhY2thZ2VOYW1lcy5sZW5ndGh9IHBhY2thZ2Uocyk6ICR7cGFja2FnZU5hbWVzLmpvaW4oJywgJyl9YCk7XG4gICAgXG4gICAgY29uc3QgaW5zdGFsbFN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICAvLyBFbnN1cmUgZGlyZWN0b3J5IGV4aXN0c1xuICAgIGlmICghZXhpc3RzU3luYyhub2RlanNEaXIpKSB7XG4gICAgICAgIG1rZGlyU3luYyhub2RlanNEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIC8vIFdyaXRlIHBhY2thZ2UuanNvblxuICAgIHdyaXRlRmlsZVN5bmMocGFja2FnZUpzb25QYXRoLCBwYWNrYWdlSnNvbkNvbnRlbnQpO1xuXG4gICAgLy8gSW5zdGFsbCBkZXBlbmRlbmNpZXNcbiAgICB0cnkge1xuICAgICAgICAvLyAtLWluc3RhbGwtbGlua3MgaXMgbmVlZGVkIHRvIGluc3RhbGwgbG9jYWwgcGFja2FnZXMgZnJvbSBmaWxlOiByZWZlcmVuY2VzXG4gICAgICAgIC8vIC0tcHJlZmVyLW9mZmxpbmUgaXMgbmVlZGVkIHRvIHNwZWVkIHVwIHRoZSBpbnN0YWxsYXRpb25cbiAgICAgICAgLy8gLS1uby1wYWNrYWdlLWxvY2sgaXMgbmVlZGVkIHRvIGF2b2lkIHBhY2thZ2UtbG9jay5qc29uIGNvbmZsaWN0c1xuICAgICAgICAvLyAtLW9taXQ9ZGV2IGlzIG5lZWRlZCB0byBhdm9pZCBpbnN0YWxsaW5nIGRldiBkZXBlbmRlbmNpZXNcbiAgICAgICAgLy8gLS1sZWdhY3ktcGVlci1kZXBzIGlzIG5lZWRlZCB0byBza2lwIHBlZXIgZGVwZW5kZW5jaWVzIChlLmcuLCBAdGVuMjRncm91cC9mdzI0IGZyb20gZncyNC1hdXRoLWNvZ25pdG8pXG4gICAgICAgIGV4ZWNTeW5jKCducG0gaW5zdGFsbCAtLW9taXQ9ZGV2IC0tbm8tcGFja2FnZS1sb2NrIC0taW5zdGFsbC1saW5rcyAtLXByZWZlci1vZmZsaW5lIC0tbGVnYWN5LXBlZXItZGVwcycsIHtcbiAgICAgICAgICAgIGN3ZDogbm9kZWpzRGlyLFxuICAgICAgICAgICAgc3RkaW86ICdpbmhlcml0J1xuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGVsYXBzZWQgPSAoKERhdGUubm93KCkgLSBpbnN0YWxsU3RhcnRUaW1lKSAvIDEwMDApLnRvRml4ZWQoMSk7XG4gICAgICAgIGxvZ2dlci5pbmZvKGAgICDinJMgbnBtIGluc3RhbGwgY29tcGxldGUgaW4gJHtlbGFwc2VkfXNgKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFNhdmUgaGFzaCBmb3IgbmV4dCBydW5cbiAgICAgICAgd3JpdGVGaWxlU3luYyhwYWNrYWdlSGFzaFBhdGgsIGN1cnJlbnRQYWNrYWdlSGFzaCk7XG4gICAgICAgIFxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcignRmFpbGVkIHRvIGluc3RhbGwgZXh0ZXJuYWwgZGVwZW5kZW5jaWVzOicsIGVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IGNvcHkgYSBkaXJlY3RvcnlcbiAqL1xuZnVuY3Rpb24gY29weURpcmVjdG9yeShzb3VyY2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpIHtcbiAgICBpZiAoIWV4aXN0c1N5bmModGFyZ2V0KSkge1xuICAgICAgICBta2RpclN5bmModGFyZ2V0LCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICB9XG4gICAgY29uc3QgaXRlbXMgPSByZWFkZGlyU3luYyhzb3VyY2UpO1xuICAgIGZvcihjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgIGNvbnN0IHNvdXJjZVBhdGggPSBwYXRoSm9pbihzb3VyY2UsIGl0ZW0pO1xuICAgICAgICBjb25zdCB0YXJnZXRQYXRoID0gcGF0aEpvaW4odGFyZ2V0LCBpdGVtKTtcbiAgICAgICAgaWYgKGxzdGF0U3luYyhzb3VyY2VQYXRoKS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBjb3B5RGlyZWN0b3J5KHNvdXJjZVBhdGgsIHRhcmdldFBhdGgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29weUZpbGVTeW5jKHNvdXJjZVBhdGgsIHRhcmdldFBhdGgpO1xuICAgICAgICB9XG4gICAgfVxufVxuIl19