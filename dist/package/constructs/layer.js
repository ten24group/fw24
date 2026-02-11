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
        if (!packageJson.dependencies) {
            packageJson.dependencies = {};
        }
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
                if (!packageJson.dependencies) {
                    packageJson.dependencies = {};
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGF5ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9sYXllci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFtaUJBLHNDQUVDO0FBbmlCRCwyQ0FBd0M7QUFDeEMsdUNBQW9DO0FBQ3BDLHVEQUF5RjtBQUN6Rix3Q0FBK0U7QUFDL0UsMENBQXVDO0FBQ3ZDLHVEQUFzRztBQUN0Ryx5Q0FBaUo7QUFDakoscUNBQXFJO0FBQ3JJLDJEQUE4QztBQUM5QyxxQ0FBOEM7QUFDOUMsOENBQTJDO0FBRTNDLDZDQUF5QztBQUN6QywwQ0FBdUM7QUE2SnZDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0EyQkc7QUFDSCxNQUFhLGNBQWM7SUFjTTtJQWJwQixNQUFNLENBQVU7SUFDaEIsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQUcsY0FBYyxDQUFDLElBQUksQ0FBQztJQUMzQixZQUFZLEdBQWEsRUFBRSxDQUFDO0lBQzVCLE1BQU0sQ0FBdUI7SUFFN0IsU0FBUyxDQUFTO0lBRWxCOzs7T0FHRztJQUNILFlBQTZCLE1BQStCLEVBQUUsVUFBbUI7UUFBcEQsV0FBTSxHQUFOLE1BQU0sQ0FBeUI7UUFFeEQsSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUNiLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDdkQsQ0FBQzthQUFNLENBQUM7WUFDSixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDcEQsQ0FBQztRQUVELGVBQWU7UUFDZixLQUFLLE1BQU0sV0FBVyxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQy9CLFdBQVcsQ0FBQyxJQUFJLEdBQUcsV0FB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MEMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNoRSxNQUFNLEtBQUssQ0FBQztJQUNoQixDQUFDO0FBQ0wsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxhQUFhLENBQUMsTUFBYyxFQUFFLE1BQWM7SUFDakQsSUFBSSxDQUFDLElBQUEsb0JBQVUsRUFBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1FBQ3RCLElBQUEsbUJBQVMsRUFBQyxNQUFNLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUMzQyxDQUFDO0lBQ0QsTUFBTSxLQUFLLEdBQUcsSUFBQSxxQkFBVyxFQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ2xDLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7UUFDdkIsTUFBTSxVQUFVLEdBQUcsSUFBQSxnQkFBUSxFQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztRQUMxQyxNQUFNLFVBQVUsR0FBRyxJQUFBLGdCQUFRLEVBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzFDLElBQUksSUFBQSxtQkFBUyxFQUFDLFVBQVUsQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7WUFDdEMsYUFBYSxDQUFDLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUMxQyxDQUFDO2FBQU0sQ0FBQztZQUNKLElBQUEsc0JBQVksRUFBQyxVQUFVLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFDekMsQ0FBQztJQUNMLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcblxuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmUvaGVscGVyXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgRGVmYXVsdExvZ2dlciwgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciwgSUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBUaW1lciB9IGZyb20gXCIuLi91dGlscy90aW1lclwiO1xuaW1wb3J0IHsgQXJjaGl0ZWN0dXJlLCBDb2RlLCBMYXllclZlcnNpb24sIExheWVyVmVyc2lvblByb3BzLCBSdW50aW1lIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBiYXNlbmFtZSBhcyBwYXRoQmFzZU5hbWUsIHJlc29sdmUgYXMgcGF0aFJlc29sdmUsIGpvaW4gYXMgcGF0aEpvaW4sIGV4dG5hbWUgYXMgcGF0aEV4dG5hbWUsIHJlbGF0aXZlIGFzIHBhdGhSZWxhdGl2ZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBleGlzdHNTeW5jLCBta2RpclN5bmMsIHJlYWRkaXJTeW5jLCBzdGF0U3luYywgcm1TeW5jLCBsc3RhdFN5bmMsIGNvcHlGaWxlU3luYywgcmVhZEZpbGVTeW5jLCB3cml0ZUZpbGVTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBleGVjU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBidWlsZCwgQnVpbGRPcHRpb25zIH0gZnJvbSAnZXNidWlsZCc7XG5pbXBvcnQgeyBMYXllckVudHJ5IH0gZnJvbSBcIi4uL2RlY29yYXRvcnNcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSBcIm5vZGU6Y3J5cHRvXCI7XG5pbXBvcnQgeyBtZXJnZSB9IGZyb20gXCIuLi91dGlscy9tZXJnZVwiO1xuXG5pbnRlcmZhY2UgSVBhY2thZ2VKc29uIHtcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgdmVyc2lvbjogc3RyaW5nO1xuICAgIGRlcGVuZGVuY2llcz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG59XG5cbi8qKlxuICogRXh0ZW5kZWQgYnVpbGQgb3B0aW9ucyB0aGF0IHN1cHBvcnQgc2VwYXJhdGluZyBucG0gaW5zdGFsbCBwYWNrYWdlcyBmcm9tIGVzYnVpbGQgZXh0ZXJuYWxzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRXh0ZW5kZWRCdWlsZE9wdGlvbnMgZXh0ZW5kcyBCdWlsZE9wdGlvbnMge1xuICAgIC8qKlxuICAgICAqIFBhY2thZ2VzIHRvIG5wbSBpbnN0YWxsIGluIHRoZSBsYXllcidzIG5vZGVfbW9kdWxlcyAocnVudGltZSBkZXBlbmRlbmNpZXMpLlxuICAgICAqIElmIG5vdCBwcm92aWRlZCwgZmFsbHMgYmFjayB0byB1c2luZyBgZXh0ZXJuYWxgIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5LlxuICAgICAqIFxuICAgICAqIFVzZSB0aGlzIHRvIHNlcGFyYXRlIHBhY2thZ2VzIHRoYXQgc2hvdWxkIGJlIG5wbSBpbnN0YWxsZWQgZnJvbSBwYWNrYWdlc1xuICAgICAqIHRoYXQgYXJlIHByb3ZpZGVkIGJ5IG90aGVyIGxheWVycyAoZS5nLiwgQHRlbjI0Z3JvdXAvZncyNCBmcm9tIGZ3MjQgbGF5ZXIpLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICoge1xuICAgICAqICAgZXh0ZXJuYWw6IFsnQHRlbjI0Z3JvdXAvZncyNCcsICdheGlvcyddLCAgICAgICAgICAgLy8gRG9uJ3QgYnVuZGxlIHRoZXNlXG4gICAgICogICBleHRlcm5hbFBhY2thZ2VzOiBbJ2F4aW9zJ10gICAgICAgICAgICAgICAgICAgICAgICAvLyBPbmx5IG5wbSBpbnN0YWxsIGF4aW9zXG4gICAgICogfSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBmdzI0IGNvbWVzIGZyb20gZncyNCBsYXllclxuICAgICAqL1xuICAgIGV4dGVybmFsUGFja2FnZXM/OiAoc3RyaW5nIHwgUmVnRXhwKVtdO1xufVxuXG4vKipcbiAqIENvbW1vbiBsYXllciBjb25maWd1cmF0aW9uIHByb3BlcnRpZXNcbiAqL1xuaW50ZXJmYWNlIElCYXNlTGF5ZXJDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgc291cmNlIHBhdGggb2YgdGhlIGxheWVyIGRpcmVjdG9yeSBvciBmaWxlLlxuICAgICAqL1xuICAgIHNvdXJjZVBhdGg6IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIHByb3BlcnRpZXMgZm9yIHRoZSBsYXllciB2ZXJzaW9uLlxuICAgICAqL1xuICAgIGxheWVyUHJvcHM/OiBPbWl0PExheWVyVmVyc2lvblByb3BzLCAnY29kZSc+O1xuXG4gICAgLyoqXG4gICAgICogQ3VzdG9tIGJ1aWxkIG9wdGlvbnMgZm9yIGVzYnVpbGQgYnVuZGxpbmcuXG4gICAgICogTWVyZ2VkIGluIHByaW9yaXR5IG9yZGVyOiBkZWZhdWx0cyA8IGNvbnN0cnVjdC1sZXZlbCA8IGRlY29yYXRvci1sZXZlbFxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICoge1xuICAgICAqICAgYnVpbGRPcHRpb25zOiB7XG4gICAgICogICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICAgKiAgICAgbWluaWZ5OiBmYWxzZSxcbiAgICAgKiAgICAgZXh0ZXJuYWw6IFsnQGF3cy1zZGsnLCAnQHRlbjI0Z3JvdXAvZncyNCcsICdheGlvcyddLCAgLy8gRG9uJ3QgYnVuZGxlXG4gICAgICogICAgIGV4dGVybmFsUGFja2FnZXM6IFsnYXhpb3MnXSAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE9ubHkgbnBtIGluc3RhbGwgYXhpb3NcbiAgICAgKiAgIH1cbiAgICAgKiB9XG4gICAgICovXG4gICAgYnVpbGRPcHRpb25zPzogRXh0ZW5kZWRCdWlsZE9wdGlvbnM7XG5cbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIHRoaXMgbGF5ZXIgc2hvdWxkIE5PVCBiZSBhZGRlZCBhcyBhIGdsb2JhbCBsYXllci5cbiAgICAgKiBJZiBmYWxzZSBvciB1bmRlZmluZWQsIHRoZSBsYXllciB3aWxsIGJlIGF1dG9tYXRpY2FsbHkgYXR0YWNoZWQgdG8gYWxsIExhbWJkYSBmdW5jdGlvbnMuXG4gICAgICogRGVmYXVsdHMgdG8gZmFsc2UgKGxheWVyIElTIGdsb2JhbCkuXG4gICAgICovXG4gICAgbm90R2xvYmFsPzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIFdoZXRoZXIgdGhpcyBsYXllciBzaG91bGQgYmUgbG9hZGVkIGFzIGFuIGVudHJ5IHBhY2thZ2UgKGNvZGUgZXhlY3V0ZXMgYXQgbW9kdWxlIGluaXRpYWxpemF0aW9uKS5cbiAgICAgKiBJZiBmYWxzZSwgdGhlIGxheWVyIGlzIG9ubHkgYXZhaWxhYmxlIGZvciBpbXBvcnRzIGJ1dCBkb2Vzbid0IGV4ZWN1dGUuXG4gICAgICogRGVmYXVsdHMgdG8gZmFsc2UuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiAvLyBmdzI0IHJ1bnRpbWUgbGF5ZXIgLSBhdmFpbGFibGUgZm9yIGltcG9ydCBidXQgZG9lc24ndCBleGVjdXRlXG4gICAgICogeyBzb3VyY2VQYXRoOiAnLi9mdzI0LmpzJywgaXNFbnRyeVBhY2thZ2U6IGZhbHNlIH1cbiAgICAgKiBcbiAgICAgKiAvLyBkaSBsYXllciAtIGV4ZWN1dGVzIERJQ29udGFpbmVyLlJPT1QubW9kdWxlKCkgYXQgaW5pdFxuICAgICAqIHsgc291cmNlUGF0aDogJy4vZGkudHMnLCBpc0VudHJ5UGFja2FnZTogdHJ1ZSB9XG4gICAgICovXG4gICAgaXNFbnRyeVBhY2thZ2U/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogUHJpb3JpdHkgZm9yIGxheWVyIGxvYWRpbmcgb3JkZXIuIExvd2VyIG51bWJlcnMgbG9hZCBmaXJzdC5cbiAgICAgKiBJZiBub3Qgc3BlY2lmaWVkLCBwcmlvcml0eSBpcyBhdXRvLWFzc2lnbmVkIGFzIChhcnJheV9pbmRleCArIDEwKS5cbiAgICAgKiBcbiAgICAgKiBQcmlvcml0eSByYW5nZXM6XG4gICAgICogLSAwLTk6IFJlc2VydmVkIGZvciBmcmFtZXdvcmsgbGF5ZXJzIChmdzI0IGNvcmUgPSAwKVxuICAgICAqIC0gMTArOiBVc2VyL2FwcGxpY2F0aW9uIGxheWVycyAoYXV0by1hc3NpZ25lZCBvciBleHBsaWNpdClcbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIC8vIEF1dG8tYXNzaWduZWQgcHJpb3JpdGllcyAocmVjb21tZW5kZWQpOlxuICAgICAqIGNvbnN0IGxheWVycyA9IG5ldyBMYXllckNvbnN0cnVjdChbXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2RpLnRzJyB9LCAgICAgICAgLy8gcHJpb3JpdHk6IDEwXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL3NoYXJlZC50cycgfSwgICAgLy8gcHJpb3JpdHk6IDExXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2ZpcmViYXNlLnRzJyB9ICAgLy8gcHJpb3JpdHk6IDEyXG4gICAgICogXSk7XG4gICAgICogXG4gICAgICogLy8gRXhwbGljaXQgcHJpb3JpdGllcyAoZm9yIHNwZWNpYWwgY2FzZXMpOlxuICAgICAqIGNvbnN0IGxheWVycyA9IG5ldyBMYXllckNvbnN0cnVjdChbXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2RpLnRzJywgcHJpb3JpdHk6IDEwIH0sICAgICAgLy8gTG9hZCBmaXJzdFxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9maXJlYmFzZS50cycsIHByaW9yaXR5OiAyMCB9LCAvLyBMb2FkIGxhc3RcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vc2hhcmVkLnRzJywgcHJpb3JpdHk6IDE1IH0gICAvLyBMb2FkIGluIGJldHdlZW5cbiAgICAgKiBdKTtcbiAgICAgKi9cbiAgICBwcmlvcml0eT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB0aGUgUEFDS0FHRV9ESVJFQ1RPUlkgbW9kZS5cbiAqIFBhY2thZ2VzIGEgcHJlLWJ1aWx0IGRpcmVjdG9yeSBhcy1pcyB3aXRob3V0IGJ1bmRsaW5nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElQYWNrYWdlRGlyZWN0b3J5Q29uZmlnIGV4dGVuZHMgSUJhc2VMYXllckNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIG5hbWUgb2YgdGhlIGxheWVyLlxuICAgICAqL1xuICAgIGxheWVyTmFtZTogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIG1vZGUgb2YgcGFja2FnaW5nOiBwYWNrYWdlIHRoZSB3aG9sZSBkaXJlY3RvcnkuXG4gICAgICovXG4gICAgbW9kZT86ICdQQUNLQUdFX0RJUkVDVE9SWSc7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIEJVSUxEX0FORF9QQUNLQUdFIG1vZGUuXG4gKiBCdW5kbGVzIHNvdXJjZSBmaWxlcyB3aXRoIGVzYnVpbGQgYmVmb3JlIHBhY2thZ2luZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnIGV4dGVuZHMgSUJhc2VMYXllckNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIG1vZGUgb2YgcGFja2FnaW5nOiBzY2FuIGFuZCBidWlsZCBpbmRpdmlkdWFsIGZpbGVzLlxuICAgICAqL1xuICAgIG1vZGU6ICdCVUlMRF9BTkRfUEFDS0FHRSc7XG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBjdXN0b20gZGlzdHJpYnV0aW9uIGRpcmVjdG9yeSBmb3IgdGhlIGJ1aWxkIG91dHB1dHMuXG4gICAgICovXG4gICAgZGlzdERpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIEZsYWcgdG8gY2xlYXIgdGhlIG91dHB1dCBkaXJlY3RvcnkgYWZ0ZXIgcGFja2FnaW5nOyBkZWZhdWx0cyB0byBmYWxzZS5cbiAgICAgKi9cbiAgICBjbGVhck91dHB1dERpcj86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBDb25maWd1cmFibGUgb3V0cHV0IHBhdGggZm9yIHRoZSBwYWNrYWdlLlxuICAgICAqL1xuICAgIHBhY2thZ2VQYXRoPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIGxheWVyIGNvbnN0cnVjdC5cbiAqIFxuICogTGF5ZXJzIGFyZSBwcm9jZXNzZWQgaW4gcGFyYWxsZWwgZm9yIHNwZWVkLCBidXQgbG9hZGVkIGF0IHJ1bnRpbWUgaW4gcHJpb3JpdHkgb3JkZXIuXG4gKiBQcmlvcml0eSBkZXRlcm1pbmVzIHRoZSBvcmRlciBpbiB3aGljaCBsYXllcnMgaW5pdGlhbGl6ZSB3aGVuIExhbWJkYSBjb2xkIHN0YXJ0cy5cbiAqIFxuICogQHNlZSBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnLnByaW9yaXR5IGZvciBwcmlvcml0eSBkZXRhaWxzXG4gKi9cbmV4cG9ydCB0eXBlIElMYXllckNvbnN0cnVjdENvbmZpZyA9IElQYWNrYWdlRGlyZWN0b3J5Q29uZmlnIHwgSUJ1aWxkQW5kUGFja2FnZUNvbmZpZztcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgY29uc3RydWN0IGZvciBjcmVhdGluZyBMYW1iZGEgbGF5ZXJzLlxuICogXG4gKiBMYXllcnMgYXJlIGJ1aWx0IGluIHBhcmFsbGVsIGZvciBwZXJmb3JtYW5jZSwgYnV0IGluaXRpYWxpemUgYXQgTGFtYmRhIHJ1bnRpbWVcbiAqIGluIHByaW9yaXR5IG9yZGVyLiBUaGlzIGVuc3VyZXMgY29ycmVjdCBkZXBlbmRlbmN5IGxvYWRpbmcgKGUuZy4sIERJIGNvbnRhaW5lclxuICogbG9hZHMgYmVmb3JlIGxheWVycyB0aGF0IHVzZSBpdCkuXG4gKiBcbiAqIFByaW9yaXR5IFN5c3RlbTpcbiAqIC0gMC05OiBSZXNlcnZlZCBmb3IgZnJhbWV3b3JrIGxheWVycyAoZncyNCBjb3JlID0gMClcbiAqIC0gMTArOiBBcHBsaWNhdGlvbiBsYXllcnMgKGF1dG8tYXNzaWduZWQgc3RhcnRpbmcgYXQgMTAsIG9yIHNldCBleHBsaWNpdGx5KVxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIEJhc2ljIHVzYWdlIHdpdGggYXV0by1wcmlvcml0eSAocmVjb21tZW5kZWQpXG4gKiBjb25zdCBkaUxheWVyID0gbmV3IERJTGF5ZXJDb25zdHJ1Y3QoW1xuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9kaS50cycgfSwgICAgICAgICAgICAgIC8vIHByaW9yaXR5OiAxMCAoYXV0bylcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvY29uZmlnL3NoYXJlZC50cycgfSwgICAvLyBwcmlvcml0eTogMTEgKGF1dG8pXG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2NvbmZpZy9maXJlYmFzZS50cycgfSAgLy8gcHJpb3JpdHk6IDEyIChhdXRvKVxuICogXSk7XG4gKiBcbiAqIC8vIEFkdmFuY2VkIHVzYWdlIHdpdGggZXhwbGljaXQgcHJpb3JpdGllc1xuICogY29uc3QgZGlMYXllciA9IG5ldyBESUxheWVyQ29uc3RydWN0KFtcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvZGkudHMnLCBwcmlvcml0eTogMTAgfSwgICAgICAgIC8vIExvYWQgZmlyc3RcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvY29uZmlnL2ZpcmViYXNlLnRzJywgcHJpb3JpdHk6IDIwIH0sIC8vIExvYWQgbGFzdFxuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9jb25maWcvc2hhcmVkLnRzJywgcHJpb3JpdHk6IDE1IH0gICAgLy8gTG9hZCBpbiBiZXR3ZWVuXG4gKiBdKTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgTGF5ZXJDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXI6IElMb2dnZXI7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblxuICAgIG5hbWUgPSBMYXllckNvbnN0cnVjdC5uYW1lO1xuICAgIGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgbWFpblN0YWNrITogU3RhY2s7XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IExheWVyQ29uc3RydWN0IGluc3RhbmNlLlxuICAgICAqIEBwYXJhbSBjb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIExheWVyQ29uc3RydWN0LlxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgY29uZmlnOiBJTGF5ZXJDb25zdHJ1Y3RDb25maWdbXSwgdmVyYm9zZUxvZz86IG51bWJlcikge1xuXG4gICAgICAgIGlmICh2ZXJib3NlTG9nKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihMYXllckNvbnN0cnVjdC5uYW1lLCAxKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyID0gY3JlYXRlTG9nZ2VyKExheWVyQ29uc3RydWN0Lm5hbWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gYWRkIGRlZmF1bHRzXG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXJDb25maWcgb2YgY29uZmlnKSB7XG4gICAgICAgICAgICBsYXllckNvbmZpZy5tb2RlID0gbGF5ZXJDb25maWcubW9kZSB8fCAnUEFDS0FHRV9ESVJFQ1RPUlknO1xuICAgICAgICAgICAgaWYgKGxheWVyQ29uZmlnLm1vZGUgPT09ICdCVUlMRF9BTkRfUEFDS0FHRScpIHtcbiAgICAgICAgICAgICAgICBsYXllckNvbmZpZy5jbGVhck91dHB1dERpciA9IGxheWVyQ29uZmlnLmNsZWFyT3V0cHV0RGlyID8/IGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgSGVscGVyLmh5ZHJhdGVDb25maWcoY29uZmlnLCAnTEFZRVInKTtcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIC8vIEFzc2lnbiBwcmlvcml0eSB0byBlYWNoIGxheWVyOiB1c2UgZXhwbGljaXQgcHJpb3JpdHkgaWYgc2V0LCBvdGhlcndpc2UgdXNlIGFycmF5IGluZGV4ICsgMTBcbiAgICAgICAgLy8gUHJpb3JpdHkgMC05IHJlc2VydmVkIGZvciBmcmFtZXdvcmsgbGF5ZXJzIChmdzI0IGNvcmUgPSAwKVxuICAgICAgICAvLyBVc2VyIGxheWVycyBzdGFydCBhdCAxMCsgdG8gZW5zdXJlIGZyYW1ld29yayBsYXllcnMgYWx3YXlzIGxvYWQgZmlyc3RcbiAgICAgICAgZm9yIChjb25zdCBbIGluZGV4LCBsYXllckNvbmZpZyBdIG9mIHRoaXMuY29uZmlnLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgaWYgKCFsYXllckNvbmZpZy5wcmlvcml0eSAmJiBsYXllckNvbmZpZy5wcmlvcml0eSAhPT0gMCkge1xuICAgICAgICAgICAgICAgIGxheWVyQ29uZmlnLnByaW9yaXR5ID0gaW5kZXggKyAxMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFByb2Nlc3MgbGF5ZXJzIGluIHBhcmFsbGVsIGZvciBzcGVlZCB3aGlsZSByZXNwZWN0aW5nIHByaW9yaXR5LWJhc2VkIGxvYWRpbmcgb3JkZXJcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwodGhpcy5jb25maWcubWFwKGFzeW5jIChsYXllckNvbmZpZykgPT4ge1xuICAgICAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sobGF5ZXJDb25maWcuc3RhY2tOYW1lIHx8IHRoaXMuZncyNC5nZXRDb25maWcoKS5sYXllclN0YWNrTmFtZSwgbGF5ZXJDb25maWcucGFyZW50U3RhY2tOYW1lKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJQcm9jZXNzaW5nIGxheWVyOlwiLCBsYXllckNvbmZpZyk7XG5cbiAgICAgICAgICAgIGlmIChsYXllckNvbmZpZy5tb2RlID09PSAnUEFDS0FHRV9ESVJFQ1RPUlknKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wYWNrYWdlRGlyZWN0b3J5KGxheWVyQ29uZmlnKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAobGF5ZXJDb25maWcubW9kZSA9PT0gJ0JVSUxEX0FORF9QQUNLQUdFJykge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuc2NhbkFuZFBhY2thZ2VGaWxlcyhsYXllckNvbmZpZyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBtb2RlIGZvciBsYXllciAke0pTT04uc3RyaW5naWZ5KGxheWVyQ29uZmlnKX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFBhY2thZ2VzIGEgZGlyZWN0b3J5IGFzIGEgTGFtYmRhIGxheWVyLlxuICAgICAqIEBwYXJhbSBsYXllckNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgbGF5ZXIuXG4gICAgICogQHBhcmFtIG1haW5TdGFjayAtIFRoZSBtYWluIHN0YWNrIGZvciBkZXBsb3lpbmcgcmVzb3VyY2VzLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgcGFja2FnZURpcmVjdG9yeShsYXllckNvbmZpZzogSVBhY2thZ2VEaXJlY3RvcnlDb25maWcpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdExheWVyUHJvcHM6IExheWVyVmVyc2lvblByb3BzID0ge1xuICAgICAgICAgICAgbGF5ZXJWZXJzaW9uTmFtZTogbGF5ZXJDb25maWcubGF5ZXJOYW1lLFxuICAgICAgICAgICAgY29tcGF0aWJsZVJ1bnRpbWVzOiBbIFJ1bnRpbWUuTk9ERUpTXzIyX1ggXSxcbiAgICAgICAgICAgIGNvZGU6IENvZGUuZnJvbUFzc2V0KGxheWVyQ29uZmlnLnNvdXJjZVBhdGgpLFxuICAgICAgICAgICAgY29tcGF0aWJsZUFyY2hpdGVjdHVyZXM6IFsgQXJjaGl0ZWN0dXJlLkFSTV82NCBdLFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGxheWVyID0gbmV3IExheWVyVmVyc2lvbih0aGlzLm1haW5TdGFjaywgbGF5ZXJDb25maWcubGF5ZXJOYW1lICsgJy1sYXllcicsIHtcbiAgICAgICAgICAgIC4uLmRlZmF1bHRMYXllclByb3BzLFxuICAgICAgICAgICAgLi4ubGF5ZXJDb25maWcubGF5ZXJQcm9wcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBsYXllckNvbmZpZy5sYXllck5hbWUsIGxheWVyLCBPdXRwdXRUeXBlLkxBWUVSLCAnbGF5ZXJWZXJzaW9uQXJuJyk7XG5cbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFNjYW5zIGEgZGlyZWN0b3J5IGZvciBUeXBlU2NyaXB0IGZpbGVzIGFuZCBjcmVhdGVzIExhbWJkYSBsYXllcnMgZm9yIHRoZW0uXG4gICAgICogQHBhcmFtIGxheWVyQ29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBsYXllci5cbiAgICAgKiBAcGFyYW0gbWFpblN0YWNrIC0gVGhlIG1haW4gc3RhY2sgZm9yIGRlcGxveWluZyByZXNvdXJjZXMuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBzY2FuQW5kUGFja2FnZUZpbGVzKGxheWVyQ29uZmlnOiBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnKSB7XG4gICAgICAgIC8vIERlZmF1bHQgdG8gYXBwbGljYXRpb24ncyBkaXN0L2xheWVycyBkaXJlY3RvcnkgKHByb2Nlc3MuY3dkKCkgaXMgdGhlIGFwcGxpY2F0aW9uIHJvb3QpXG4gICAgICAgIGNvbnN0IGRpc3REaXJlY3RvcnkgPSBsYXllckNvbmZpZy5kaXN0RGlyZWN0b3J5IHx8IHBhdGhKb2luKHByb2Nlc3MuY3dkKCksICdkaXN0L2xheWVycycpO1xuICAgICAgICBjb25zdCBzb3VyY2VEaXJlY3RvcnlPckZpbGVOYW1lID0gcGF0aFJlc29sdmUobGF5ZXJDb25maWcuc291cmNlUGF0aCk7XG4gICAgICAgIGNvbnN0IHRzRmlsZXMgPSBsc3RhdFN5bmMoc291cmNlRGlyZWN0b3J5T3JGaWxlTmFtZSkuaXNEaXJlY3RvcnkoKVxuICAgICAgICAgICAgPyBzY2FuRGlyZWN0b3J5KHNvdXJjZURpcmVjdG9yeU9yRmlsZU5hbWUpXG4gICAgICAgICAgICA6IFsgc291cmNlRGlyZWN0b3J5T3JGaWxlTmFtZSBdO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgZmlsZXMgaW4gcGFyYWxsZWwgbm93IHRoYXQgd2UgaGF2ZSBwcmlvcml0eS1iYXNlZCBvcmRlcmluZ1xuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbCh0c0ZpbGVzLm1hcChhc3luYyAoZmlsZSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy50cnlDcmVhdGVMYXllckZvckZpbGUoZmlsZSwgZGlzdERpcmVjdG9yeSwgbGF5ZXJDb25maWcpO1xuICAgICAgICB9KSk7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBNZXJnZXMgYnVpbGQgb3B0aW9ucyB3aXRoIHByb3BlciBwcmlvcml0eTogZGVmYXVsdHMgPCBjb25zdHJ1Y3QtbGV2ZWwgPCBkZWNvcmF0b3ItbGV2ZWxcbiAgICAgKiBAcGFyYW0gbGF5ZXJOYW1lIC0gTGF5ZXIgbmFtZSBmb3IgbG9nZ2luZ1xuICAgICAqIEBwYXJhbSBjb25zdHJ1Y3RCdWlsZE9wdGlvbnMgLSBCdWlsZCBvcHRpb25zIGZyb20gY29uc3RydWN0IGNvbmZpZ1xuICAgICAqIEBwYXJhbSBkZWNvcmF0b3JCdWlsZE9wdGlvbnMgLSBCdWlsZCBvcHRpb25zIGZyb20gQExheWVyRW50cnkgZGVjb3JhdG9yXG4gICAgICogQHJldHVybnMgTWVyZ2VkIGJ1aWxkIG9wdGlvbnNcbiAgICAgKi9cbiAgICBwcml2YXRlIG1lcmdlQnVpbGRPcHRpb25zKFxuICAgICAgICBsYXllck5hbWU6IHN0cmluZyxcbiAgICAgICAgY29uc3RydWN0QnVpbGRPcHRpb25zPzogRXh0ZW5kZWRCdWlsZE9wdGlvbnMsXG4gICAgICAgIGRlY29yYXRvckJ1aWxkT3B0aW9ucz86IEV4dGVuZGVkQnVpbGRPcHRpb25zXG4gICAgKTogRXh0ZW5kZWRCdWlsZE9wdGlvbnMge1xuICAgICAgICAvLyBEZWZhdWx0IGJ1aWxkIG9wdGlvbnMgZm9yIGFsbCBsYXllcnNcbiAgICAgICAgY29uc3QgZGVmYXVsdEJ1aWxkT3B0aW9uczogQnVpbGRPcHRpb25zID0ge1xuICAgICAgICAgICAgYnVuZGxlOiB0cnVlLFxuICAgICAgICAgICAgcGxhdGZvcm06ICdub2RlJyxcbiAgICAgICAgICAgIHRhcmdldDogJ25vZGUxOCcsXG4gICAgICAgICAgICBtaW5pZnk6IGZhbHNlLFxuICAgICAgICAgICAgc291cmNlbWFwOiBmYWxzZSxcbiAgICAgICAgICAgIGV4dGVybmFsOiBbXG4gICAgICAgICAgICAgICAgLy8gRnJhbWV3b3JrIHJ1bnRpbWUgcHJvdmlkZWQgYnkgc2VwYXJhdGUgZncyNCBsYXllclxuICAgICAgICAgICAgICAgICdAdGVuMjRncm91cC9mdzI0JyxcbiAgICAgICAgICAgICAgICAvLyBBV1MgU0RLIGFuZCBidWlsZCB0b29sc1xuICAgICAgICAgICAgICAgICdAYXdzLXNkaycsXG4gICAgICAgICAgICAgICAgJ0BzbWl0aHknLFxuICAgICAgICAgICAgICAgICdhd3MtY2RrLWxpYicsXG4gICAgICAgICAgICAgICAgJ2VzYnVpbGQnLFxuICAgICAgICAgICAgXVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIE1lcmdlIGluIHByaW9yaXR5IG9yZGVyIHVzaW5nIGRlZXAgbWVyZ2VcbiAgICAgICAgY29uc3QgbWVyZ2VkID0gKG1lcmdlKFtcbiAgICAgICAgICAgIGRlZmF1bHRCdWlsZE9wdGlvbnMsXG4gICAgICAgICAgICBjb25zdHJ1Y3RCdWlsZE9wdGlvbnMgfHwge30sXG4gICAgICAgICAgICBkZWNvcmF0b3JCdWlsZE9wdGlvbnMgfHwge31cbiAgICAgICAgXSkgPz8gZGVmYXVsdEJ1aWxkT3B0aW9ucyk7XG5cbiAgICAgICAgLy8gTG9nIG1lcmdlZCBjb25maWd1cmF0aW9uXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBbJHtsYXllck5hbWV9XSBCdWlsZCBvcHRpb25zIG1lcmdlZDpgLCB7XG4gICAgICAgICAgICBzb3VyY2VtYXA6IG1lcmdlZC5zb3VyY2VtYXAsXG4gICAgICAgICAgICBtaW5pZnk6IG1lcmdlZC5taW5pZnksXG4gICAgICAgICAgICBleHRlcm5hbDogbWVyZ2VkLmV4dGVybmFsLFxuICAgICAgICAgICAgcGxhdGZvcm06IG1lcmdlZC5wbGF0Zm9ybSxcbiAgICAgICAgICAgIHRhcmdldDogbWVyZ2VkLnRhcmdldFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gbWVyZ2VkO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEF0dGVtcHRzIHRvIGNyZWF0ZSBhIExhbWJkYSBsYXllciBmb3IgYSBnaXZlbiBUeXBlU2NyaXB0IGZpbGUuXG4gICAgICogQHBhcmFtIGZpbGUgLSBUaGUgcGF0aCB0byB0aGUgVHlwZVNjcmlwdCBmaWxlLlxuICAgICAqIEBwYXJhbSBkaXN0RGlyZWN0b3J5IC0gVGhlIG91dHB1dCBkaXJlY3RvcnkgZm9yIHRoZSBidWlsZC5cbiAgICAgKiBAcGFyYW0gbWFpblN0YWNrIC0gVGhlIG1haW4gc3RhY2sgZm9yIGRlcGxveWluZyByZXNvdXJjZXMuXG4gICAgICogQHBhcmFtIGxheWVyQ29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBsYXllci5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHRyeUNyZWF0ZUxheWVyRm9yRmlsZShmaWxlOiBzdHJpbmcsIGRpc3REaXJlY3Rvcnk6IHN0cmluZywgbGF5ZXJDb25maWc6IElCdWlsZEFuZFBhY2thZ2VDb25maWcpIHtcbiAgICAgICAgY29uc3QgZmlsZUJhc2VOYW1lID0gcGF0aEJhc2VOYW1lKGZpbGUsIHBhdGhFeHRuYW1lKGZpbGUpKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgUHJvY2Vzc2luZyBsYXllcjogJHtmaWxlQmFzZU5hbWV9YCk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYExvYWRpbmcgbGF5ZXIgZGVzY3JpcHRvciBmcm9tICR7ZmlsZX0uLi5gKTtcbiAgICAgICAgY29uc3QgbW9kdWxlRXhwb3J0cyA9IGF3YWl0IGltcG9ydChmaWxlKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYExheWVyIGRlc2NyaXB0b3IgbG9hZGVkYCk7XG5cbiAgICAgICAgY29uc3QgZm91bmRMYXllckRlc2NyaXB0b3JOYW1lID0gT2JqZWN0LmtleXMobW9kdWxlRXhwb3J0cykuZmluZCgoa2V5KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBleHBvcnRlZCA9IG1vZHVsZUV4cG9ydHNbIGtleSBdO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRlZCA9PT0gJ2Z1bmN0aW9uJyAmJiBpc0xheWVyRW50cnkoZXhwb3J0ZWQpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4cG9ydGVkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoIWZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gTGF5ZXJFbnRyeSBmb3VuZCBpbiBmaWxlICR7ZmlsZX0uIFdpbGwgdXNlIERlZmF1bHQgb3B0aW9ucy5gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIExheWVyRW50cnkoe1xuICAgICAgICAgICAgbm90R2xvYmFsOiBsYXllckNvbmZpZy5ub3RHbG9iYWwgPz8gZmFsc2UsXG4gICAgICAgICAgICBpc0VudHJ5UGFja2FnZTogbGF5ZXJDb25maWcuaXNFbnRyeVBhY2thZ2UgPz8gZmFsc2VcbiAgICAgICAgfSlcbiAgICAgICAgY2xhc3MgRW1wdHlMYXllckRlc2NyaXB0b3IgeyB9XG5cbiAgICAgICAgLy8gaWYgbm8gbGF5ZXIgZGVzY3JpcHRvciBmb3VuZCBpbiB0aGUgZmlsZSwgY3JlYXRlIGFuIGVtcHR5IGNsYXNzIHdoaWNoIHdpbGwgdXNlIGRlZmF1bHQgb3B0aW9uc1xuICAgICAgICBjb25zdCBsYXllckRlc2NyaXB0b3IgPSBmb3VuZExheWVyRGVzY3JpcHRvck5hbWUgPyBtb2R1bGVFeHBvcnRzWyBmb3VuZExheWVyRGVzY3JpcHRvck5hbWUgXSA6IEVtcHR5TGF5ZXJEZXNjcmlwdG9yO1xuXG4gICAgICAgIGNvbnN0IGxheWVyTmFtZSA9IGdldExheWVyTmFtZShsYXllckRlc2NyaXB0b3IpIHx8IGZpbGVCYXNlTmFtZTtcblxuICAgICAgICAvLyBNZXJnZSBidWlsZCBvcHRpb25zOiBkZWZhdWx0cyA8IGNvbnN0cnVjdC1sZXZlbCA8IGRlY29yYXRvci1sZXZlbFxuICAgICAgICBjb25zdCBkZWNvcmF0b3JCdWlsZE9wdGlvbnMgPSBnZXRMYXllckJ1aWxkT3B0aW9ucyhsYXllckRlc2NyaXB0b3IpO1xuICAgICAgICBjb25zdCBidWlsZE9wdGlvbnMgPSB0aGlzLm1lcmdlQnVpbGRPcHRpb25zKFxuICAgICAgICAgICAgbGF5ZXJOYW1lLFxuICAgICAgICAgICAgbGF5ZXJDb25maWcuYnVpbGRPcHRpb25zLFxuICAgICAgICAgICAgZGVjb3JhdG9yQnVpbGRPcHRpb25zXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gRGV0ZXJtaW5lIHBhY2thZ2Ugc3RydWN0dXJlOlxuICAgICAgICAvLyAtIElmIHBhY2thZ2VQYXRoIGlzIHNldDogdXNlIGl0IGFzIHRoZSBmdWxsIG1vZHVsZSBwYXRoIChlLmcuLCBAdGVuMjRncm91cC9mdzI0KVxuICAgICAgICAvLyAtIElmIG5vdCBzZXQ6IHVzZSBmaWxlQmFzZU5hbWUgYXMgdGhlIHBhY2thZ2UgbmFtZSAoZS5nLiwgZGksIHNoYXJlZClcbiAgICAgICAgY29uc3QgcGFja2FnZU5hbWUgPSBsYXllckNvbmZpZy5wYWNrYWdlUGF0aCB8fCBmaWxlQmFzZU5hbWU7XG4gICAgICAgIGNvbnN0IGNvbmZpZ3VyZWRPdXRwdXRQYXRoID0gYG5vZGVqcy9ub2RlX21vZHVsZXMvJHtwYWNrYWdlTmFtZX1gO1xuXG4gICAgICAgIGNvbnN0IG91dHB1dERpciA9IHBhdGhKb2luKGRpc3REaXJlY3RvcnksIGxheWVyTmFtZSwgY29uZmlndXJlZE91dHB1dFBhdGgpO1xuICAgICAgICBjb25zdCBidW5kbGVEaXIgPSBwYXRoSm9pbihkaXN0RGlyZWN0b3J5LCBsYXllck5hbWUpO1xuXG4gICAgICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgICAgICAvLyBCVUlMRCBMQVlFUjogZXNidWlsZCArIG5wbSBpbnN0YWxsICh3aXRoIG5wbSBpbnN0YWxsIGNhY2hpbmcpXG4gICAgICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBCdWlsZGluZyBsYXllci4uLmApO1xuICAgICAgICBjb25zdCBidWlsZFRpbWVyID0gVGltZXIuc3RhcnQoKTtcblxuICAgICAgICAvLyBFbnN1cmUgb3V0cHV0IGRpcmVjdG9yeSBleGlzdHNcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKG91dHB1dERpcikpIHtcbiAgICAgICAgICAgIG1rZGlyU3luYyhvdXRwdXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSW5zdGFsbCBleHRlcm5hbCBkZXBlbmRlbmNpZXMgRklSU1QgKHdpdGggc21hcnQgY2FjaGluZyB0byBza2lwIGlmIHVuY2hhbmdlZClcbiAgICAgICAgLy8gVXNlIGJ1aWxkT3B0aW9ucy5leHRlcm5hbFBhY2thZ2VzIGlmIHByb3ZpZGVkLCBvdGhlcndpc2UgZmFsbCBiYWNrIHRvIGJ1aWxkT3B0aW9ucy5leHRlcm5hbCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgICAvLyBUaGlzIGFsbG93cyBzZXBhcmF0aW5nIHBhY2thZ2VzIHRvIG5wbSBpbnN0YWxsIGZyb20gcGFja2FnZXMgdG8gbWFyayBhcyBleHRlcm5hbCBpbiBlc2J1aWxkXG4gICAgICAgIGNvbnN0IGV4dGVybmFsUGFja2FnZXMgPSBidWlsZE9wdGlvbnMuZXh0ZXJuYWxQYWNrYWdlc1xuICAgICAgICAgICAgPyAoQXJyYXkuaXNBcnJheShidWlsZE9wdGlvbnMuZXh0ZXJuYWxQYWNrYWdlcykgPyBidWlsZE9wdGlvbnMuZXh0ZXJuYWxQYWNrYWdlcyA6IFtdKVxuICAgICAgICAgICAgOiAoYnVpbGRPcHRpb25zLmV4dGVybmFsICYmIEFycmF5LmlzQXJyYXkoYnVpbGRPcHRpb25zLmV4dGVybmFsKSkgPyBidWlsZE9wdGlvbnMuZXh0ZXJuYWwgOiBbXTtcblxuICAgICAgICBpZiAoZXh0ZXJuYWxQYWNrYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBjb25zdCBpbnN0YWxsVGltZXIgPSBUaW1lci5zdGFydCgpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gWzEvMl0gSW5zdGFsbGluZyBleHRlcm5hbCBkZXBlbmRlbmNpZXMuLi5gKTtcbiAgICAgICAgICAgIGF3YWl0IGluc3RhbGxFeHRlcm5hbERlcGVuZGVuY2llc09wdGltaXplZChidW5kbGVEaXIsIGV4dGVybmFsUGFja2FnZXMsIHRoaXMubG9nZ2VyKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dICAgIOKckyBEZXBlbmRlbmNpZXMgaW5zdGFsbGVkICgke2luc3RhbGxUaW1lci5lbGFwc2VkU2Vjb25kcygpfSlgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRoZW4gYnVuZGxlIGFwcGxpY2F0aW9uIGNvZGUgaW50byBub2RlX21vZHVsZXNcbiAgICAgICAgY29uc3Qgb3V0cHV0RmlsZSA9IHBhdGhKb2luKG91dHB1dERpciwgJ2luZGV4LmpzJyk7XG4gICAgICAgIGNvbnN0IGJ1bmRsZVRpbWVyID0gVGltZXIuc3RhcnQoKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gWzIvMl0gQnVuZGxpbmcgd2l0aCBlc2J1aWxkLi4uYCk7XG4gICAgICAgIGF3YWl0IGJ1bmRsZVdpdGhFc2J1aWxkKGZpbGUsIG91dHB1dEZpbGUsIGJ1aWxkT3B0aW9ucyk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dICAgIOKckyBCdW5kbGUgY29tcGxldGUgKCR7YnVuZGxlVGltZXIuZWxhcHNlZFNlY29uZHMoKX0pYCk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIHBhY2thZ2UuanNvbiBmb3IgTm9kZS5qcyBtb2R1bGUgcmVzb2x1dGlvblxuICAgICAgICAvLyBXaXRob3V0IHRoaXMsIHJlcXVpcmUoJ0BwYWNrYWdlL25hbWUnKSB3b24ndCB3b3JrIGV2ZW4gaWYgaW5kZXguanMgZXhpc3RzXG4gICAgICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHBhdGhKb2luKG91dHB1dERpciwgJ3BhY2thZ2UuanNvbicpO1xuICAgICAgICBjb25zdCBwYWNrYWdlSnNvbiA9IHtcbiAgICAgICAgICAgIG5hbWU6IHBhY2thZ2VOYW1lLFxuICAgICAgICAgICAgdmVyc2lvbjogXCIxLjAuMFwiLFxuICAgICAgICAgICAgbWFpbjogXCJpbmRleC5qc1wiLFxuICAgICAgICAgICAgdHlwZTogXCJjb21tb25qc1wiXG4gICAgICAgIH07XG4gICAgICAgIHdyaXRlRmlsZVN5bmMocGFja2FnZUpzb25QYXRoLCBKU09OLnN0cmluZ2lmeShwYWNrYWdlSnNvbiwgbnVsbCwgMikpO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSAgICDinJMgQ3JlYXRlZCBwYWNrYWdlLmpzb24gZm9yIG1vZHVsZSByZXNvbHV0aW9uYCk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0g4pyTIEJ1aWxkIGNvbXBsZXRlIGluICR7YnVpbGRUaW1lci5lbGFwc2VkU2Vjb25kcygpfWApXG5cbiAgICAgICAgLy8gSW1wb3J0IHBhdGg6IC9vcHQvbm9kZWpzL25vZGVfbW9kdWxlcy97cGFja2FnZU5hbWV9L2luZGV4LmpzXG4gICAgICAgIC8vIE5vZGUuanMgd2lsbCByZXNvbHZlIHRoaXMgdG8gdGhlIGJ1bmRsZWQgZW50cnkgcG9pbnRcbiAgICAgICAgY29uc3QgbGF5ZXJJbXBvcnRQYXRoID0gcGF0aEpvaW4oJy9vcHQnLCBjb25maWd1cmVkT3V0cHV0UGF0aCwgJ2luZGV4LmpzJyk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIExheWVyIGltcG9ydCBwYXRoOiAke2xheWVySW1wb3J0UGF0aH1gKTtcblxuICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShsYXllck5hbWUsIGxheWVySW1wb3J0UGF0aCwgJ2xheWVySW1wb3J0UGF0aCcpO1xuXG4gICAgICAgIGlmIChpc0dsb2JhbExheWVyKGxheWVyRGVzY3JpcHRvcikpIHtcbiAgICAgICAgICAgIC8vIEF0dGFjaCB0aGlzIGxheWVyIHRvIGFsbCBMYW1iZGEgZnVuY3Rpb25zXG4gICAgICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyhsYXllck5hbWUpO1xuXG4gICAgICAgICAgICAvLyBPbmx5IGFkZCBhcyBlbnRyeSBwYWNrYWdlIGlmIGl0IG5lZWRzIHRvIGV4ZWN1dGUgYXQgbW9kdWxlIGluaXRpYWxpemF0aW9uXG4gICAgICAgICAgICBpZiAoaXNFbnRyeVBhY2thZ2UobGF5ZXJEZXNjcmlwdG9yKSkge1xuICAgICAgICAgICAgICAgIC8vIGNvbGxlY3QgZ2xvYmFsIGVudHJ5LXBhY2thZ2VzIGZvciBsYW1iZGFzIHdpdGggcHJpb3JpdHkgZm9yIGNvcnJlY3QgbG9hZGluZyBvcmRlclxuICAgICAgICAgICAgICAgIC8vIFByaW9yaXR5IGlzIGFsd2F5cyBzZXQgaW4gY29uc3RydWN0KCksIHNvIGl0IG11c3QgYmUgZGVmaW5lZCBoZXJlXG4gICAgICAgICAgICAgICAgaWYgKGxheWVyQ29uZmlnLnByaW9yaXR5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBMYXllciAke2xheWVyTmFtZX0gaGFzIG5vIHByaW9yaXR5LiBUaGlzIHNob3VsZCBuZXZlciBoYXBwZW4uYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5hZGRHbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2UoYGVudjpsYXllckltcG9ydFBhdGg6JHtsYXllck5hbWV9YCwgbGF5ZXJDb25maWcucHJpb3JpdHkpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIFJlZ2lzdGVyZWQgYXMgZW50cnkgcGFja2FnZSAocHJpb3JpdHk6ICR7bGF5ZXJDb25maWcucHJpb3JpdHl9KWApO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBMYXllciBhdHRhY2hlZCBidXQgTk9UIGFuIGVudHJ5IHBhY2thZ2UgKGF2YWlsYWJsZSBmb3IgaW1wb3J0IG9ubHkpYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYXllclByb3BzID0gZ2V0TGF5ZXJQcm9wcyhsYXllckRlc2NyaXB0b3IpO1xuXG4gICAgICAgIGNvbnN0IGRlZmF1bHRMYXllclByb3BzOiBMYXllclZlcnNpb25Qcm9wcyA9IHtcbiAgICAgICAgICAgIGxheWVyVmVyc2lvbk5hbWU6IGxheWVyTmFtZSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVSdW50aW1lczogWyBSdW50aW1lLk5PREVKU18yMl9YIF0sXG4gICAgICAgICAgICBjb2RlOiBDb2RlLmZyb21Bc3NldChidW5kbGVEaXIpLFxuICAgICAgICAgICAgY29tcGF0aWJsZUFyY2hpdGVjdHVyZXM6IFsgQXJjaGl0ZWN0dXJlLkFSTV82NCBdLFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGxheWVyID0gbmV3IExheWVyVmVyc2lvbih0aGlzLm1haW5TdGFjaywgbGF5ZXJOYW1lICsgJy1sYXllcicsIHtcbiAgICAgICAgICAgIC4uLmRlZmF1bHRMYXllclByb3BzLFxuICAgICAgICAgICAgLi4ubGF5ZXJDb25maWcubGF5ZXJQcm9wcyxcbiAgICAgICAgICAgIC4uLmxheWVyUHJvcHMsIC8vIHRoZSBsYXllclByb3BzIGZyb20gdGhlIGRlY29yYXRvciB0YWtlIHByZWNlZGVuY2VcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBsYXllck5hbWUsIGxheWVyLCBPdXRwdXRUeXBlLkxBWUVSLCAnbGF5ZXJWZXJzaW9uQXJuJyk7XG5cbiAgICAgICAgLy8gQ2xlYW4gdXAgdGhlIHRlbXBvcmFyeSBvdXRwdXQgZGlyZWN0b3J5IGlmIGNvbmZpZ3VyZWRcbiAgICAgICAgaWYgKGxheWVyQ29uZmlnLmNsZWFyT3V0cHV0RGlyKSB7XG4gICAgICAgICAgICBjbGVhbnVwRGlyZWN0b3J5KG91dHB1dERpcik7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qKlxuICogUmVjdXJzaXZlbHkgc2NhbnMgYSBkaXJlY3RvcnkgYW5kIHJldHVybnMgYSBsaXN0IG9mIFR5cGVTY3JpcHQgZmlsZXMuXG4gKiBAcGFyYW0gZGlyZWN0b3J5IC0gVGhlIGRpcmVjdG9yeSB0byBzY2FuLlxuICogQHJldHVybnMgQW4gYXJyYXkgb2YgVHlwZVNjcmlwdCBmaWxlIHBhdGhzLlxuICovXG5mdW5jdGlvbiBzY2FuRGlyZWN0b3J5KGRpcmVjdG9yeTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGxldCBmaWxlczogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBpdGVtcyA9IHJlYWRkaXJTeW5jKGRpcmVjdG9yeSk7XG5cbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICAgICAgY29uc3QgZnVsbFBhdGggPSBwYXRoSm9pbihkaXJlY3RvcnksIGl0ZW0pO1xuICAgICAgICBjb25zdCBzdGF0ID0gc3RhdFN5bmMoZnVsbFBhdGgpO1xuXG4gICAgICAgIGlmIChzdGF0LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIGZpbGVzID0gZmlsZXMuY29uY2F0KHNjYW5EaXJlY3RvcnkoZnVsbFBhdGgpKTtcbiAgICAgICAgfSBlbHNlIGlmIChzdGF0LmlzRmlsZSgpICYmIGZ1bGxQYXRoLmVuZHNXaXRoKCcudHMnKSkge1xuICAgICAgICAgICAgZmlsZXMucHVzaChmdWxsUGF0aCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmlsZXM7XG59XG5cbmZ1bmN0aW9uIGlzTGF5ZXJFbnRyeSh0YXJnZXQ6IEZ1bmN0aW9uKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuICEhZ2V0TGF5ZXJOYW1lKHRhcmdldCk7XG59XG5cbmZ1bmN0aW9uIGlzR2xvYmFsTGF5ZXIodGFyZ2V0OiBGdW5jdGlvbik6IGJvb2xlYW4ge1xuICAgIHJldHVybiAhUmVmbGVjdC5nZXQodGFyZ2V0LCAnbm90R2xvYmFsJyk7XG59XG5cbmZ1bmN0aW9uIGlzRW50cnlQYWNrYWdlKHRhcmdldDogRnVuY3Rpb24pOiBib29sZWFuIHtcbiAgICBjb25zdCB2YWx1ZSA9IFJlZmxlY3QuZ2V0KHRhcmdldCwgJ2lzRW50cnlQYWNrYWdlJyk7XG4gICAgLy8gRGVmYXVsdCB0byBGQUxTRSAtIGxheWVycyBhcmUgTk9UIGVudHJ5IHBhY2thZ2VzIHVubGVzcyBleHBsaWNpdGx5IG1hcmtlZFxuICAgIC8vIEVudHJ5IHBhY2thZ2VzIGV4ZWN1dGUgY29kZSBhdCBMYW1iZGEgaW5pdDsgbW9zdCBsYXllcnMgYXJlIGp1c3QgcnVudGltZSBsaWJyYXJpZXNcbiAgICByZXR1cm4gdmFsdWUgPT09IHRydWU7XG59XG5cbmZ1bmN0aW9uIGdldExheWVyTmFtZSh0YXJnZXQ6IEZ1bmN0aW9uKSB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRhcmdldCwgJ2xheWVyTmFtZScpO1xufVxuXG5mdW5jdGlvbiBnZXRMYXllckJ1aWxkT3B0aW9ucyh0YXJnZXQ6IEZ1bmN0aW9uKTogQnVpbGRPcHRpb25zIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGFyZ2V0LCAnYnVpbGRPcHRpb25zJyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRMYXllclByb3BzKHRhcmdldDogRnVuY3Rpb24pOiBMYXllclZlcnNpb25Qcm9wcyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRhcmdldCwgJ2xheWVyUHJvcHMnKTtcbn1cblxuLyoqXG4gKiBCdW5kbGVzIGEgVHlwZVNjcmlwdCBmaWxlIHVzaW5nIGVzYnVpbGQgd2l0aCB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIEJ1aWxkIG9wdGlvbnMgc2hvdWxkIGFscmVhZHkgYmUgbWVyZ2VkIHZpYSBtZXJnZUJ1aWxkT3B0aW9ucygpLlxuICogQHBhcmFtIGVudHJ5RmlsZSAtIFRoZSBlbnRyeSBmaWxlIHRvIGJ1bmRsZS5cbiAqIEBwYXJhbSBvdXRwdXRGaWxlIC0gVGhlIG91dHB1dCBmaWxlIHBhdGggZm9yIHRoZSBidW5kbGUuXG4gKiBAcGFyYW0gYnVpbGRPcHRpb25zIC0gUHJlLW1lcmdlZCBidWlsZCBvcHRpb25zIChtYXkgaW5jbHVkZSBjdXN0b20gZmllbGRzIGxpa2UgZXh0ZXJuYWxQYWNrYWdlcykuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGJ1bmRsZVdpdGhFc2J1aWxkKGVudHJ5RmlsZTogc3RyaW5nLCBvdXRwdXRGaWxlOiBzdHJpbmcsIGJ1aWxkT3B0aW9uczogRXh0ZW5kZWRCdWlsZE9wdGlvbnMpIHtcbiAgICAvLyBTdHJpcCBvdXQgY3VzdG9tIGZpZWxkcyB0aGF0IGVzYnVpbGQgZG9lc24ndCByZWNvZ25pemVcbiAgICBjb25zdCB7IGV4dGVybmFsUGFja2FnZXM6IF9leHRlcm5hbFBhY2thZ2VzLCAuLi5lc2J1aWxkT3B0aW9ucyB9ID0gYnVpbGRPcHRpb25zO1xuXG4gICAgY29uc3QgZmluYWxPcHRpb25zOiBCdWlsZE9wdGlvbnMgPSB7XG4gICAgICAgIC4uLmVzYnVpbGRPcHRpb25zLFxuICAgICAgICBvdXRmaWxlOiBvdXRwdXRGaWxlLFxuICAgICAgICBlbnRyeVBvaW50czogWyBlbnRyeUZpbGUgXSxcbiAgICB9O1xuXG4gICAgRGVmYXVsdExvZ2dlci5kZWJ1ZyhgYnVuZGxlV2l0aEVzYnVpbGQ6ICR7ZW50cnlGaWxlfSDihpIgJHtvdXRwdXRGaWxlfWApO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgYnVpbGQoZmluYWxPcHRpb25zKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gYnVuZGxlICR7ZW50cnlGaWxlfTpgLCBlcnJvcik7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgZXNidWlsZCBmYWlsZWQgZm9yICR7ZW50cnlGaWxlfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgfVxufVxuXG4vKipcbiAqIENhbGN1bGF0ZXMgaGFzaCBvZiBhIGZpbGUncyBjb250ZW50c1xuICovXG5mdW5jdGlvbiBjYWxjdWxhdGVGaWxlSGFzaChmaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBjb250ZW50ID0gcmVhZEZpbGVTeW5jKGZpbGVQYXRoKTtcbiAgICByZXR1cm4gY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKGNvbnRlbnQpLmRpZ2VzdCgnaGV4Jyk7XG59XG5cbi8qKlxuICogSGFzaGVzIGEgZGlyZWN0b3J5J3MgY29udGVudHMgcmVjdXJzaXZlbHkgZm9yIGNoYW5nZSBkZXRlY3Rpb25cbiAqIFVzZWQgZm9yIGxvY2FsIHBhY2thZ2UgZGVwZW5kZW5jaWVzIHRvIGRldGVjdCB3aGVuIHRoZXkndmUgYmVlbiByZWJ1aWx0XG4gKiBAcGFyYW0gZGlyUGF0aCAtIERpcmVjdG9yeSB0byBoYXNoICh0eXBpY2FsbHkgYSBkaXN0IGZvbGRlcilcbiAqIEByZXR1cm5zIFNIQS0yNTYgaGFzaCBvZiBhbGwgZmlsZSBjb250ZW50c1xuICovXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IGhhc2hlcyB0aGUgY29udGVudHMgb2YgYSBkaXJlY3RvcnkgZm9yIGNoYW5nZSBkZXRlY3Rpb24uXG4gKiBTa2lwcyBjb21tb24gbm9uLXJ1bnRpbWUgZGlyZWN0b3JpZXMgKG5vZGVfbW9kdWxlcywgLmdpdCwgdGVzdCwgZXRjLilcbiAqIFJldHVybnMgY29uc2lzdGVudCBTSEEtMjU2IGhhc2ggZXZlbiBmb3IgZW1wdHkgZGlyZWN0b3JpZXMuXG4gKiBcbiAqIEBwYXJhbSBkaXJQYXRoIC0gQWJzb2x1dGUgcGF0aCB0byBkaXJlY3RvcnkgdG8gaGFzaFxuICogQHJldHVybnMgU0hBLTI1NiBoYXNoICg2NCBoZXggY2hhcmFjdGVycylcbiAqL1xuZnVuY3Rpb24gaGFzaERpcmVjdG9yeUNvbnRlbnRzKGRpclBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgaGFzaCA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpO1xuICAgIGxldCBmaWxlQ291bnQgPSAwO1xuXG4gICAgY29uc3QgaGFzaERpclJlY3Vyc2l2ZSA9IChjdXJyZW50UGF0aDogc3RyaW5nKSA9PiB7XG4gICAgICAgIGlmICghZXhpc3RzU3luYyhjdXJyZW50UGF0aCkpIHJldHVybjtcblxuICAgICAgICBjb25zdCBzdGF0ID0gbHN0YXRTeW5jKGN1cnJlbnRQYXRoKTtcblxuICAgICAgICBpZiAoc3RhdC5pc1N5bWJvbGljTGluaygpKSB7XG4gICAgICAgICAgICAvLyBTa2lwIHN5bWxpbmtzIHRvIGF2b2lkIGluZmluaXRlIGxvb3BzIGFuZCBpbmNvbnNpc3RlbnQgYmVoYXZpb3JcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChzdGF0LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGl0ZW1zID0gcmVhZGRpclN5bmMoY3VycmVudFBhdGgpLnNvcnQoKGEsIGIpID0+IGEubG9jYWxlQ29tcGFyZShiKSk7IC8vIFNvcnQgZm9yIGRldGVybWluaXN0aWMgaGFzaGluZ1xuICAgICAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgICAgICAgICAgLy8gU2tpcCBjb21tb24gZGlyZWN0b3JpZXMgdGhhdCBkb24ndCBhZmZlY3QgcnVudGltZVxuICAgICAgICAgICAgICAgIGlmIChpdGVtID09PSAnbm9kZV9tb2R1bGVzJyB8fCBpdGVtID09PSAnLmdpdCcgfHxcbiAgICAgICAgICAgICAgICAgICAgaXRlbSA9PT0gJ3Rlc3QnIHx8IGl0ZW0gPT09ICdfX3Rlc3RzX18nIHx8XG4gICAgICAgICAgICAgICAgICAgIGl0ZW0gPT09ICdjb3ZlcmFnZScgfHwgaXRlbSA9PT0gJy5EU19TdG9yZScpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBoYXNoRGlyUmVjdXJzaXZlKHBhdGhKb2luKGN1cnJlbnRQYXRoLCBpdGVtKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoc3RhdC5pc0ZpbGUoKSkge1xuICAgICAgICAgICAgZmlsZUNvdW50Kys7XG4gICAgICAgICAgICAvLyBIYXNoIGZpbGUgcGF0aCAocmVsYXRpdmUpIGZvciB1bmlxdWVuZXNzXG4gICAgICAgICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBwYXRoUmVsYXRpdmUoZGlyUGF0aCwgY3VycmVudFBhdGgpO1xuICAgICAgICAgICAgaGFzaC51cGRhdGUocmVsYXRpdmVQYXRoKTtcbiAgICAgICAgICAgIC8vIEhhc2ggZmlsZSBjb250ZW50c1xuICAgICAgICAgICAgaGFzaC51cGRhdGUocmVhZEZpbGVTeW5jKGN1cnJlbnRQYXRoKSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgLy8gSGFzaCB0aGUgZGlyZWN0b3J5IHBhdGggaXRzZWxmIGZpcnN0IGZvciB1bmlxdWVuZXNzXG4gICAgaGFzaC51cGRhdGUoZGlyUGF0aCk7XG4gICAgaGFzaERpclJlY3Vyc2l2ZShkaXJQYXRoKTtcblxuICAgIC8vIElmIG5vIGZpbGVzIHdlcmUgZm91bmQsIHVwZGF0ZSBoYXNoIHdpdGggc2VudGluZWwgdmFsdWVcbiAgICAvLyBUaGlzIGVuc3VyZXMgZW1wdHkgZGlyZWN0b3JpZXMgaGF2ZSBhIGRpZmZlcmVudCBoYXNoIHRoYW4gbm9uLWV4aXN0ZW50IG9uZXNcbiAgICBpZiAoZmlsZUNvdW50ID09PSAwKSB7XG4gICAgICAgIGhhc2gudXBkYXRlKCdfX0VNUFRZX0RJUkVDVE9SWV9fJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGhhc2guZGlnZXN0KCdoZXgnKTtcbn1cblxuXG4vKipcbiAqIENsZWFucyB1cCBhIHRlbXBvcmFyeSBkaXJlY3RvcnkgYnkgcmVtb3ZpbmcgYWxsIGZpbGVzIGFuZCBzdWJkaXJlY3Rvcmllcy5cbiAqIEBwYXJhbSBkaXJlY3RvcnkgLSBUaGUgZGlyZWN0b3J5IHRvIGNsZWFuIHVwLlxuICovXG5mdW5jdGlvbiBjbGVhbnVwRGlyZWN0b3J5KGRpcmVjdG9yeTogc3RyaW5nKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgcm1TeW5jKGRpcmVjdG9yeSwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYGJ1bmRsZVdpdGhFc2J1aWxkOiBDbGVhbmVkIHVwIHRlbXBvcmFyeSBkaXJlY3Rvcnk6ICR7ZGlyZWN0b3J5fWApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuZXJyb3IoYGJ1bmRsZVdpdGhFc2J1aWxkOiBGYWlsZWQgdG8gY2xlYW4gdXAgZGlyZWN0b3J5ICR7ZGlyZWN0b3J5fTpgLCBlcnJvcik7XG4gICAgfVxufVxuXG4vKipcbiAqIE9QVElNSVpFRDogSW5zdGFsbHMgZXh0ZXJuYWwgZGVwZW5kZW5jaWVzIHdpdGggaW50ZWxsaWdlbnQgY2FjaGluZ1xuICogXG4gKiBAcGFyYW0gbGF5ZXJPdXRwdXREaXIgLSBUaGUgT1VUUFVUIGRpcmVjdG9yeSBmb3IgdGhlIGxheWVyIChlLmcuLCBkaXN0L2xheWVycy9kaSlcbiAqIEBwYXJhbSBleHRlcm5hbFBhY2thZ2VzIC0gQXJyYXkgb2YgcGFja2FnZSBuYW1lcyB0byBpbnN0YWxsIChlLmcuLCBbJ2F4aW9zJywgJ2ZpcmViYXNlLWFkbWluJ10pXG4gKiBAcGFyYW0gbG9nZ2VyIC0gTG9nZ2VyIGluc3RhbmNlIGZvciBvdXRwdXRcbiAqL1xuYXN5bmMgZnVuY3Rpb24gaW5zdGFsbEV4dGVybmFsRGVwZW5kZW5jaWVzT3B0aW1pemVkKGxheWVyT3V0cHV0RGlyOiBzdHJpbmcsIGV4dGVybmFsUGFja2FnZXM6IChzdHJpbmcgfCBSZWdFeHApW10sIGxvZ2dlcjogSUxvZ2dlcikge1xuICAgIC8vIEZpbHRlciBvdXQgcmVnZXggcGF0dGVybnMsIGZyYW1ld29yayBwYWNrYWdlcywgYW5kIHBhY2thZ2VzIHByb3ZpZGVkIGJ5IG90aGVyIGxheWVyc1xuICAgIGNvbnN0IHBhY2thZ2VOYW1lcyA9IGV4dGVybmFsUGFja2FnZXMuZmlsdGVyKHBrZyA9PlxuICAgICAgICB0eXBlb2YgcGtnID09PSAnc3RyaW5nJyAmJlxuICAgICAgICAhcGtnLnN0YXJ0c1dpdGgoJ0Bhd3Mtc2RrJykgJiYgICAgICAvLyBQcm92aWRlZCBieSBMYW1iZGEgcnVudGltZVxuICAgICAgICAhcGtnLnN0YXJ0c1dpdGgoJ0BzbWl0aHknKSAmJiAgICAgICAvLyBQcm92aWRlZCBieSBMYW1iZGEgcnVudGltZVxuICAgICAgICAhcGtnLnN0YXJ0c1dpdGgoJ2F3cy1jZGstbGliJykgJiYgICAvLyBCdWlsZC10aW1lIG9ubHlcbiAgICAgICAgcGtnICE9PSAnZXNidWlsZCcgJiYgICAgICAgICAgICAgICAgLy8gQnVpbGQtdGltZSBvbmx5XG4gICAgICAgIHBrZyAhPT0gJ0B0ZW4yNGdyb3VwL2Z3MjQnICAgICAgICAgIC8vIFByb3ZpZGVkIGJ5IGZ3MjQgcnVudGltZSBsYXllciAobm90IGRpIGxheWVyKVxuICAgICkgYXMgc3RyaW5nW107XG5cbiAgICBpZiAocGFja2FnZU5hbWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgbm9kZWpzRGlyID0gcGF0aEpvaW4obGF5ZXJPdXRwdXREaXIsICdub2RlanMnKTtcbiAgICBjb25zdCBub2RlTW9kdWxlc0RpciA9IHBhdGhKb2luKG5vZGVqc0RpciwgJ25vZGVfbW9kdWxlcycpO1xuICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHBhdGhKb2luKG5vZGVqc0RpciwgJ3BhY2thZ2UuanNvbicpO1xuICAgIGNvbnN0IHBhY2thZ2VIYXNoUGF0aCA9IHBhdGhKb2luKG5vZGVqc0RpciwgJy5wYWNrYWdlLWhhc2gnKTtcblxuICAgIC8vIEJ1aWxkIGRlc2lyZWQgcGFja2FnZS5qc29uXG4gICAgY29uc3QgcGFja2FnZUpzb246IElQYWNrYWdlSnNvbiA9IHtcbiAgICAgICAgbmFtZTogJ2xheWVyLWRlcGVuZGVuY2llcycsXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXG4gICAgICAgIGRlcGVuZGVuY2llczoge31cbiAgICB9O1xuXG4gICAgLy8gUmVhZCB0aGUgcHJvamVjdCdzIHBhY2thZ2UuanNvbiB0byBnZXQgdmVyc2lvbiBudW1iZXJzXG4gICAgY29uc3QgcHJvamVjdFJvb3QgPSBwYXRoUmVzb2x2ZShwcm9jZXNzLmN3ZCgpKTtcbiAgICBjb25zdCBwcm9qZWN0UGFja2FnZUpzb25QYXRoID0gcGF0aEpvaW4ocHJvamVjdFJvb3QsICdwYWNrYWdlLmpzb24nKTtcblxuICAgIC8vIFRyYWNrIGxvY2FsIHBhY2thZ2UgY29udGVudCBoYXNoZXMgZm9yIGNoYW5nZSBkZXRlY3Rpb25cbiAgICBjb25zdCBsb2NhbFBhY2thZ2VIYXNoZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcblxuICAgIGlmICghZXhpc3RzU3luYyhwcm9qZWN0UGFja2FnZUpzb25QYXRoKSkge1xuICAgICAgICBsb2dnZXIud2FybihgcGFja2FnZS5qc29uIG5vdCBmb3VuZCBhdCAke3Byb2plY3RQYWNrYWdlSnNvblBhdGh9LCBpbnN0YWxsaW5nIGxhdGVzdCB2ZXJzaW9uc2ApO1xuICAgICAgICBpZiAoIXBhY2thZ2VKc29uLmRlcGVuZGVuY2llcykge1xuICAgICAgICAgICAgcGFja2FnZUpzb24uZGVwZW5kZW5jaWVzID0ge307XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBwa2cgb2YgcGFja2FnZU5hbWVzKSB7XG4gICAgICAgICAgICBwYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXNbIHBrZyBdID0gJ2xhdGVzdCc7XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBwcm9qZWN0UGFja2FnZUpzb24gPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhwcm9qZWN0UGFja2FnZUpzb25QYXRoLCAndXRmLTgnKSk7XG4gICAgICAgIC8vIE9OTFkgdXNlIHJ1bnRpbWUgZGVwZW5kZW5jaWVzIC0gZGV2RGVwZW5kZW5jaWVzIGFyZSBidWlsZC10aW1lIHRvb2xzLCBub3QgTGFtYmRhIHJ1bnRpbWUhXG4gICAgICAgIGNvbnN0IHJ1bnRpbWVEZXBzID0gcHJvamVjdFBhY2thZ2VKc29uLmRlcGVuZGVuY2llcyB8fCB7fTtcblxuICAgICAgICBmb3IgKGNvbnN0IHBrZyBvZiBwYWNrYWdlTmFtZXMpIHtcbiAgICAgICAgICAgIGlmIChydW50aW1lRGVwc1sgcGtnIF0pIHtcbiAgICAgICAgICAgICAgICBsZXQgZGVwVmFsdWUgPSBydW50aW1lRGVwc1sgcGtnIF07XG5cbiAgICAgICAgICAgICAgICAvLyBIYW5kbGUgbG9jYWwgZmlsZXN5c3RlbSBkZXBlbmRlbmNpZXMgKGUuZy4sIFwiLi4vZncyNC9cIiwgXCJmaWxlOi4uL2Z3MjRcIiwgb3IgXCIuLlxcZncyNFwiIG9uIFdpbmRvd3MpXG4gICAgICAgICAgICAgICAgY29uc3QgaXNMb2NhbERlcCA9IGRlcFZhbHVlLnN0YXJ0c1dpdGgoJ2ZpbGU6JykgfHxcbiAgICAgICAgICAgICAgICAgICAgZGVwVmFsdWUuc3RhcnRzV2l0aCgnLi4vJykgfHxcbiAgICAgICAgICAgICAgICAgICAgZGVwVmFsdWUuc3RhcnRzV2l0aCgnLi8nKSB8fFxuICAgICAgICAgICAgICAgICAgICBkZXBWYWx1ZS5zdGFydHNXaXRoKCcuLlxcXFwnKSB8fFxuICAgICAgICAgICAgICAgICAgICBkZXBWYWx1ZS5zdGFydHNXaXRoKCcuXFxcXCcpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGlzTG9jYWxEZXApIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbG9jYWxQYXRoID0gZGVwVmFsdWUucmVwbGFjZSgnZmlsZTonLCAnJyk7XG4gICAgICAgICAgICAgICAgICAgIC8vIFJlc29sdmUgYWJzb2x1dGUgcGF0aCBvZiB0aGUgbG9jYWwgcGFja2FnZVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSBwYXRoUmVzb2x2ZShwcm9qZWN0Um9vdCwgbG9jYWxQYXRoKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBWYWxpZGF0ZSBsb2NhbCBwYWNrYWdlIGV4aXN0c1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoYWJzb2x1dGVQYXRoKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNc2cgPSBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYOKdjCBMb2NhbCBwYWNrYWdlIFwiJHtwa2d9XCIgcGF0aCBkb2VzIG5vdCBleGlzdDogJHthYnNvbHV0ZVBhdGh9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAgU3BlY2lmaWVkIGluIHBhY2thZ2UuanNvbiBhczogJHtkZXBWYWx1ZX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICBSZXNvbHZlZCBmcm9tIHByb2plY3Qgcm9vdDogJHtwcm9qZWN0Um9vdH1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICBQbGVhc2UgZW5zdXJlIHRoZSBsb2NhbCBwYWNrYWdlIHBhdGggaXMgY29ycmVjdC5gXG4gICAgICAgICAgICAgICAgICAgICAgICBdLmpvaW4oJ1xcbicpO1xuICAgICAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGVycm9yTXNnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTG9jYWwgcGFja2FnZSBwYXRoIG5vdCBmb3VuZDogJHtwa2d9IC0+ICR7YWJzb2x1dGVQYXRofWApO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gQ1JJVElDQUw6IFZhbGlkYXRlIHRoYXQgbG9jYWwgcGFja2FnZSBpcyBidWlsdCAoaGFzIGRpc3QgZm9sZGVyKVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXN0UGF0aCA9IHBhdGhKb2luKGFic29sdXRlUGF0aCwgJ2Rpc3QnKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGRpc3RQYXRoKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNc2cgPSBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYOKdjCBMb2NhbCBwYWNrYWdlIFwiJHtwa2d9XCIgaGFzIG5vIGRpc3QgZm9sZGVyOiAke2Rpc3RQYXRofWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIExvY2FsIHBhY2thZ2VzIE1VU1QgYmUgYnVpbHQgYmVmb3JlIGJlaW5nIHVzZWQgYXMgZGVwZW5kZW5jaWVzLmAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIFBsZWFzZSBydW4gdGhlIGJ1aWxkIGNvbW1hbmQgaW46ICR7YWJzb2x1dGVQYXRofWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIEV4YW1wbGU6IGNkICR7YWJzb2x1dGVQYXRofSAmJiBucG0gcnVuIGJ1aWxkYFxuICAgICAgICAgICAgICAgICAgICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvZ2dlci5lcnJvcihlcnJvck1zZyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYExvY2FsIHBhY2thZ2Ugbm90IGJ1aWx0OiAke3BrZ30gKG1pc3NpbmcgZGlzdCBmb2xkZXIpYCk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAvLyBIYXNoIHRoZSBkaXN0IGZvbGRlciBjb250ZW50cyBmb3IgY2hhbmdlIGRldGVjdGlvblxuICAgICAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4oaSIEhhc2hpbmcgbG9jYWwgcGFja2FnZSBcIiR7cGtnfVwiIGRpc3QgZm9sZGVyLi4uYCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRlbnRIYXNoID0gaGFzaERpcmVjdG9yeUNvbnRlbnRzKGRpc3RQYXRoKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBWYWxpZGF0ZSBoYXNoIGlzIG5vbi1lbXB0eSAoZGlzdCBmb2xkZXIgaGFzIGFjdHVhbCBmaWxlcylcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbnRlbnRIYXNoPy5sZW5ndGggIT09IDY0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgICAg4pqg77iPICBVbmV4cGVjdGVkIGhhc2ggZm9yIFwiJHtwa2d9XCI6ICR7Y29udGVudEhhc2h9YCk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBsb2NhbFBhY2thZ2VIYXNoZXNbIHBrZyBdID0gY29udGVudEhhc2g7XG4gICAgICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGAgICDihpIgTG9jYWwgcGFja2FnZSBcIiR7cGtnfVwiIGhhc2g6ICR7Y29udGVudEhhc2guc3Vic3RyaW5nKDAsIDEyKX0uLi4gKCR7cGtnfSlgKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBDYWxjdWxhdGUgcmVsYXRpdmUgcGF0aCBmcm9tIGxheWVyJ3Mgbm9kZWpzIGRpciB0byBsb2NhbCBwYWNrYWdlXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aEZyb21MYXllciA9IHBhdGhSZWxhdGl2ZShub2RlanNEaXIsIGFic29sdXRlUGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIGRlcFZhbHVlID0gcmVsYXRpdmVQYXRoRnJvbUxheWVyO1xuICAgICAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4oaSIFJlc29sdmVkIGxvY2FsIHBhY2thZ2UgXCIke3BrZ31cIjogJHtyZWxhdGl2ZVBhdGhGcm9tTGF5ZXJ9YCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFwYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgcGFja2FnZUpzb24uZGVwZW5kZW5jaWVzID0ge307XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHBhY2thZ2VKc29uLmRlcGVuZGVuY2llc1sgcGtnIF0gPSBkZXBWYWx1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gUGFja2FnZSBub3QgZm91bmQgaW4gZGVwZW5kZW5jaWVzIC0gdGhpcyBpcyBhIGNvbmZpZ3VyYXRpb24gZXJyb3JcbiAgICAgICAgICAgICAgICBjb25zdCBlcnJvck1zZyA9IFtcbiAgICAgICAgICAgICAgICAgICAgYOKdjCBQYWNrYWdlIFwiJHtwa2d9XCIgbm90IGZvdW5kIGluIHJ1bnRpbWUgZGVwZW5kZW5jaWVzLmAsXG4gICAgICAgICAgICAgICAgICAgIGAgICBUaGlzIHBhY2thZ2UgaXMgbWFya2VkIGFzICdleHRlcm5hbCcgaW4gdGhlIGxheWVyIGJ1aWxkIGJ1dCBpcyBub3QgaW4gcGFja2FnZS5qc29uIGRlcGVuZGVuY2llcy5gLFxuICAgICAgICAgICAgICAgICAgICBgICAgQWRkIFwiJHtwa2d9XCIgdG8gZGVwZW5kZW5jaWVzIGluIHBhY2thZ2UuanNvbiB3aXRoIGEgc3BlY2lmaWMgdmVyc2lvbi5gLFxuICAgICAgICAgICAgICAgICAgICBgICAgRXhhbXBsZTogbnBtIGluc3RhbGwgJHtwa2d9IC0tc2F2ZWAsXG4gICAgICAgICAgICAgICAgICAgIGAgICBUaGVuIHJlYnVpbGQgdGhlIGxheWVyLmBcbiAgICAgICAgICAgICAgICBdLmpvaW4oJ1xcbicpO1xuXG4gICAgICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGVycm9yTXNnKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcnVudGltZSBkZXBlbmRlbmN5OiAke3BrZ31gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBwYWNrYWdlSnNvbkNvbnRlbnQgPSBKU09OLnN0cmluZ2lmeShwYWNrYWdlSnNvbiwgbnVsbCwgMik7XG4gICAgY29uc3QgaGFzaCA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpO1xuICAgIGhhc2gudXBkYXRlKHBhY2thZ2VKc29uQ29udGVudCk7XG5cbiAgICAvLyBDUklUSUNBTDogSW5jbHVkZSBsb2NhbCBwYWNrYWdlIGNvbnRlbnQgaGFzaGVzIGluIHRoZSBjYWNoZSBrZXlcbiAgICAvLyBUaGlzIGVuc3VyZXMgd2UgcmVpbnN0YWxsIHdoZW4gbG9jYWwgcGFja2FnZXMgY2hhbmdlIChlLmcuLCBmdzI0IHVwZGF0ZXMpXG4gICAgaWYgKE9iamVjdC5rZXlzKGxvY2FsUGFja2FnZUhhc2hlcykubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYCAgIOKGkiBJbmNsdWRpbmcgJHtPYmplY3Qua2V5cyhsb2NhbFBhY2thZ2VIYXNoZXMpLmxlbmd0aH0gbG9jYWwgcGFja2FnZSBjb250ZW50IGhhc2hlcyBpbiBjYWNoZSBrZXlgKTtcbiAgICAgICAgZm9yIChjb25zdCBwa2cgb2YgT2JqZWN0LmtleXMobG9jYWxQYWNrYWdlSGFzaGVzKS5zb3J0KChhLCBiKSA9PiBhLmxvY2FsZUNvbXBhcmUoYikpKSB7XG4gICAgICAgICAgICBoYXNoLnVwZGF0ZShgJHtwa2d9OiR7bG9jYWxQYWNrYWdlSGFzaGVzWyBwa2cgXX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGN1cnJlbnRQYWNrYWdlSGFzaCA9IGhhc2guZGlnZXN0KCdoZXgnKTtcblxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIEZBU1QgUEFUSDogQ2hlY2sgaWYgd2UgY2FuIHNraXAgbnBtIGluc3RhbGxcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICBsZXQgc2tpcFJlYXNvbjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKCFleGlzdHNTeW5jKHBhY2thZ2VIYXNoUGF0aCkpIHtcbiAgICAgICAgc2tpcFJlYXNvbiA9ICdObyBwcmV2aW91cyBoYXNoIGZpbGUgZm91bmQgKGZpcnN0IGJ1aWxkKSc7XG4gICAgfSBlbHNlIGlmICghZXhpc3RzU3luYyhub2RlTW9kdWxlc0RpcikpIHtcbiAgICAgICAgc2tpcFJlYXNvbiA9ICdub2RlX21vZHVsZXMgZGlyZWN0b3J5IG5vdCBmb3VuZCc7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHByZXZpb3VzSGFzaCA9IHJlYWRGaWxlU3luYyhwYWNrYWdlSGFzaFBhdGgsICd1dGYtOCcpLnRyaW0oKTtcbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIGhhc2ggZm9ybWF0IChTSEEtMjU2ID0gNjQgaGV4IGNoYXJzKVxuICAgICAgICAgICAgaWYgKHByZXZpb3VzSGFzaC5sZW5ndGggIT09IDY0IHx8ICEvXlswLTlhLWZdezY0fSQvLnRlc3QocHJldmlvdXNIYXNoKSkge1xuICAgICAgICAgICAgICAgIHNraXBSZWFzb24gPSBgSW52YWxpZCBoYXNoIGZvcm1hdCBpbiBjYWNoZSBmaWxlIChnb3QgJHtwcmV2aW91c0hhc2gubGVuZ3RofSBjaGFycylgO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChwcmV2aW91c0hhc2ggPT09IGN1cnJlbnRQYWNrYWdlSGFzaCkge1xuICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGAgICDinJMgRGVwZW5kZW5jaWVzIHVuY2hhbmdlZCwgc2tpcHBpbmcgbnBtIGluc3RhbGwgKHNhdmVkIH4xMXMpYCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuOyAvLyBGQVNUIFBBVEggU1VDQ0VTUyFcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2tpcFJlYXNvbiA9ICdEZXBlbmRlbmN5IGNoYW5nZXMgZGV0ZWN0ZWQnO1xuICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGAgICDihpIgUHJldmlvdXMgaGFzaDogJHtwcmV2aW91c0hhc2guc3Vic3RyaW5nKDAsIDEyKX0uLi5gKTtcbiAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4oaSIEN1cnJlbnQgaGFzaDogICR7Y3VycmVudFBhY2thZ2VIYXNoLnN1YnN0cmluZygwLCAxMil9Li4uYCk7XG4gICAgICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKGxvY2FsUGFja2FnZUhhc2hlcykubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4oaSIExvY2FsIHBhY2thZ2VzIGluY2x1ZGVkIGluIGhhc2g6ICR7T2JqZWN0LmtleXMobG9jYWxQYWNrYWdlSGFzaGVzKS5qb2luKCcsICcpfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IHVua25vd24pIHtcbiAgICAgICAgICAgIHNraXBSZWFzb24gPSBgRmFpbGVkIHRvIHJlYWQgaGFzaCBmaWxlOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWA7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvLyBTTE9XIFBBVEg6IE5lZWQgdG8gcnVuIG5wbSBpbnN0YWxsXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgbG9nZ2VyLmluZm8oYCAgIPCfk6YgUnVubmluZyBucG0gaW5zdGFsbCAocmVhc29uOiAke3NraXBSZWFzb259KWApO1xuICAgIGxvZ2dlci5pbmZvKGAgICDihpIgSW5zdGFsbGluZyAke3BhY2thZ2VOYW1lcy5sZW5ndGh9IHBhY2thZ2Uocyk6ICR7cGFja2FnZU5hbWVzLmpvaW4oJywgJyl9YCk7XG5cbiAgICBjb25zdCBpbnN0YWxsU3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgIC8vIEVuc3VyZSBkaXJlY3RvcnkgZXhpc3RzXG4gICAgaWYgKCFleGlzdHNTeW5jKG5vZGVqc0RpcikpIHtcbiAgICAgICAgbWtkaXJTeW5jKG5vZGVqc0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgLy8gV3JpdGUgcGFja2FnZS5qc29uXG4gICAgd3JpdGVGaWxlU3luYyhwYWNrYWdlSnNvblBhdGgsIHBhY2thZ2VKc29uQ29udGVudCk7XG5cbiAgICAvLyBJbnN0YWxsIGRlcGVuZGVuY2llc1xuICAgIHRyeSB7XG4gICAgICAgIC8vIC0taW5zdGFsbC1saW5rcyBpcyBuZWVkZWQgdG8gaW5zdGFsbCBsb2NhbCBwYWNrYWdlcyBmcm9tIGZpbGU6IHJlZmVyZW5jZXNcbiAgICAgICAgLy8gLS1wcmVmZXItb2ZmbGluZSBpcyBuZWVkZWQgdG8gc3BlZWQgdXAgdGhlIGluc3RhbGxhdGlvblxuICAgICAgICAvLyAtLW5vLXBhY2thZ2UtbG9jayBpcyBuZWVkZWQgdG8gYXZvaWQgcGFja2FnZS1sb2NrLmpzb24gY29uZmxpY3RzXG4gICAgICAgIC8vIC0tb21pdD1kZXYgaXMgbmVlZGVkIHRvIGF2b2lkIGluc3RhbGxpbmcgZGV2IGRlcGVuZGVuY2llc1xuICAgICAgICAvLyAtLWxlZ2FjeS1wZWVyLWRlcHMgaXMgbmVlZGVkIHRvIHNraXAgcGVlciBkZXBlbmRlbmNpZXMgKGUuZy4sIEB0ZW4yNGdyb3VwL2Z3MjQgZnJvbSBmdzI0LWF1dGgtY29nbml0bylcbiAgICAgICAgZXhlY1N5bmMoJ25wbSBpbnN0YWxsIC0tb21pdD1kZXYgLS1uby1wYWNrYWdlLWxvY2sgLS1pbnN0YWxsLWxpbmtzIC0tcHJlZmVyLW9mZmxpbmUgLS1sZWdhY3ktcGVlci1kZXBzJywge1xuICAgICAgICAgICAgY3dkOiBub2RlanNEaXIsXG4gICAgICAgICAgICBzdGRpbzogJ2luaGVyaXQnXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGVsYXBzZWQgPSAoKERhdGUubm93KCkgLSBpbnN0YWxsU3RhcnRUaW1lKSAvIDEwMDApLnRvRml4ZWQoMSk7XG4gICAgICAgIGxvZ2dlci5pbmZvKGAgICDinJMgbnBtIGluc3RhbGwgY29tcGxldGUgaW4gJHtlbGFwc2VkfXNgKTtcblxuICAgICAgICAvLyBTYXZlIGhhc2ggZm9yIG5leHQgcnVuXG4gICAgICAgIHdyaXRlRmlsZVN5bmMocGFja2FnZUhhc2hQYXRoLCBjdXJyZW50UGFja2FnZUhhc2gpO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gaW5zdGFsbCBleHRlcm5hbCBkZXBlbmRlbmNpZXM6JywgZXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG59XG5cbi8qKlxuICogUmVjdXJzaXZlbHkgY29weSBhIGRpcmVjdG9yeVxuICovXG5mdW5jdGlvbiBjb3B5RGlyZWN0b3J5KHNvdXJjZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZykge1xuICAgIGlmICghZXhpc3RzU3luYyh0YXJnZXQpKSB7XG4gICAgICAgIG1rZGlyU3luYyh0YXJnZXQsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cbiAgICBjb25zdCBpdGVtcyA9IHJlYWRkaXJTeW5jKHNvdXJjZSk7XG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgIGNvbnN0IHNvdXJjZVBhdGggPSBwYXRoSm9pbihzb3VyY2UsIGl0ZW0pO1xuICAgICAgICBjb25zdCB0YXJnZXRQYXRoID0gcGF0aEpvaW4odGFyZ2V0LCBpdGVtKTtcbiAgICAgICAgaWYgKGxzdGF0U3luYyhzb3VyY2VQYXRoKS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBjb3B5RGlyZWN0b3J5KHNvdXJjZVBhdGgsIHRhcmdldFBhdGgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29weUZpbGVTeW5jKHNvdXJjZVBhdGgsIHRhcmdldFBhdGgpO1xuICAgICAgICB9XG4gICAgfVxufVxuIl19