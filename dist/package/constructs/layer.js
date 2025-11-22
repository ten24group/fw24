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
        // ═══════════════════════════════════════════════════════════════
        // BUILD LAYER: esbuild + npm install (with npm install caching)
        // ═══════════════════════════════════════════════════════════════
        this.logger.info(`[${layerName}] Building layer...`);
        const buildStartTime = Date.now();
        // Ensure output directory exists
        if (!(0, fs_1.existsSync)(outputDir)) {
            (0, fs_1.mkdirSync)(outputDir, { recursive: true });
        }
        // Install external dependencies FIRST (with smart caching to skip if unchanged)
        const externalPackages = (buildOptions.external && Array.isArray(buildOptions.external)) ? buildOptions.external : [];
        if (externalPackages.length > 0) {
            this.logger.info(`[${layerName}] [1/2] Installing external dependencies...`);
            await installExternalDependenciesOptimized(bundleDir, externalPackages, this.logger);
        }
        // Then bundle application code into node_modules
        const outputFile = (0, path_1.join)(outputDir, 'index.js');
        this.logger.info(`[${layerName}] [2/2] Bundling with esbuild...`);
        await bundleWithEsbuild(file, outputFile, buildOptions);
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
    const content = (0, fs_1.readFileSync)(filePath);
    return (0, crypto_1.createHash)('sha256').update(content).digest('hex');
}
/**
 * Hashes a directory's contents recursively for change detection
 * Used for local package dependencies to detect when they've been rebuilt
 * @param dirPath - Directory to hash (typically a dist folder)
 * @returns SHA-256 hash of all file contents
 */
function hashDirectoryContents(dirPath) {
    const hash = (0, crypto_1.createHash)('sha256');
    const hashDirRecursive = (currentPath) => {
        if (!(0, fs_1.existsSync)(currentPath))
            return;
        const stat = (0, fs_1.lstatSync)(currentPath);
        if (stat.isSymbolicLink()) {
            // Skip symlinks to avoid infinite loops
            return;
        }
        if (stat.isDirectory()) {
            const items = (0, fs_1.readdirSync)(currentPath).sort(); // Sort for deterministic hashing
            items.forEach(item => {
                // Skip common directories that don't affect runtime
                if (item === 'node_modules' || item === '.git' || item === 'test' || item === '__tests__' || item === 'coverage') {
                    return;
                }
                hashDirRecursive((0, path_1.join)(currentPath, item));
            });
        }
        else if (stat.isFile()) {
            // Hash file path (relative) for uniqueness
            const relativePath = (0, path_1.relative)(dirPath, currentPath);
            hash.update(relativePath);
            // Hash file contents
            hash.update((0, fs_1.readFileSync)(currentPath));
        }
    };
    hashDirRecursive(dirPath);
    return hash.digest('hex');
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
    // Track local package content hashes for change detection
    const localPackageHashes = {};
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
                // Handle local filesystem dependencies (e.g., "../fw24/", "file:../fw24", or "..\fw24" on Windows)
                const isLocalDep = depValue.startsWith('file:') ||
                    depValue.startsWith('../') ||
                    depValue.startsWith('./') ||
                    depValue.startsWith('..\\') ||
                    depValue.startsWith('.\\');
                if (isLocalDep) {
                    const localPath = depValue.replace('file:', '');
                    // Resolve absolute path of the local package
                    const absolutePath = (0, path_1.resolve)(projectRoot, localPath);
                    if ((0, fs_1.existsSync)(absolutePath)) {
                        // Calculate relative path from nodejsDir to the local package
                        const relativePathFromLayer = (0, path_1.relative)(nodejsDir, absolutePath);
                        depValue = relativePathFromLayer;
                        // CRITICAL: Hash the contents of the local package to detect changes
                        // Check if package has a dist folder (built packages)
                        const distPath = (0, path_1.join)(absolutePath, 'dist');
                        if ((0, fs_1.existsSync)(distPath)) {
                            logger.info(`   → Hashing local package "${pkg}" dist folder for change detection...`);
                            const contentHash = hashDirectoryContents(distPath);
                            localPackageHashes[pkg] = contentHash;
                            logger.debug(`   → Local package "${pkg}" content hash: ${contentHash.substring(0, 8)}...`);
                        }
                        else {
                            logger.warn(`   ⚠️  Local package "${pkg}" has no dist folder, change detection may miss updates`);
                        }
                        logger.info(`   → Resolved local package "${pkg}": ${relativePathFromLayer}`);
                    }
                    else {
                        logger.warn(`⚠️  Local package path not found: ${absolutePath}`);
                    }
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
        });
    }
    const packageJsonContent = JSON.stringify(packageJson, null, 2);
    const hash = (0, crypto_1.createHash)('sha256');
    hash.update(packageJsonContent);
    // CRITICAL: Include local package content hashes in the cache key
    // This ensures we reinstall when local packages change (e.g., fw24 updates)
    if (Object.keys(localPackageHashes).length > 0) {
        logger.debug(`   → Including ${Object.keys(localPackageHashes).length} local package content hashes in cache key`);
        Object.keys(localPackageHashes).sort().forEach(pkg => {
            hash.update(`${pkg}:${localPackageHashes[pkg]}`);
        });
    }
    const currentPackageHash = hash.digest('hex');
    // ═══════════════════════════════════════════════════════════════
    // FAST PATH: Check if we can skip npm install
    // ═══════════════════════════════════════════════════════════════
    if ((0, fs_1.existsSync)(packageHashPath) && (0, fs_1.existsSync)(nodeModulesDir)) {
        try {
            const previousHash = (0, fs_1.readFileSync)(packageHashPath, 'utf-8').trim();
            // Validate hash format (SHA-256 = 64 hex chars)
            if (previousHash.length === 64 && /^[0-9a-f]{64}$/.test(previousHash)) {
                if (previousHash === currentPackageHash) {
                    logger.info(`   ✓ Dependencies already installed, skipping npm install`);
                    return; // SAVED 11+ SECONDS!
                }
            }
            else {
                logger.warn(`   ⚠️  Invalid hash in ${packageHashPath}, rebuilding for safety`);
            }
        }
        catch (error) {
            logger.warn(`   ⚠️  Failed to read hash file, rebuilding for safety:`, error);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGF5ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9sYXllci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFtZkEsc0NBRUM7QUFuZkQsMkNBQXdDO0FBQ3hDLHVDQUFvQztBQUNwQyx1REFBeUY7QUFDekYsd0NBQStFO0FBQy9FLHVEQUFzRztBQUN0RywrQkFBNEk7QUFDNUksMkJBQTRJO0FBQzVJLGlEQUF5QztBQUN6QyxxQ0FBOEM7QUFDOUMsOENBQTJDO0FBRTNDLG1DQUFvQztBQUNwQywwQ0FBdUM7QUFtSXZDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0EyQkc7QUFDSCxNQUFhLGNBQWM7SUFjSDtJQWJYLE1BQU0sQ0FBVTtJQUNoQixJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBRyxjQUFjLENBQUMsSUFBSSxDQUFDO0lBQzNCLFlBQVksR0FBYSxFQUFFLENBQUM7SUFDNUIsTUFBTSxDQUF1QjtJQUU3QixTQUFTLENBQVM7SUFFbEI7OztPQUdHO0lBQ0gsWUFBb0IsTUFBK0IsRUFBRSxVQUFvQjtRQUFyRCxXQUFNLEdBQU4sTUFBTSxDQUF5QjtRQUUvQyxJQUFHLFVBQVUsRUFBQyxDQUFDO1lBQ1gsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQztRQUN2RCxDQUFDO2FBQU0sQ0FBQztZQUNKLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNwRCxDQUFDO1FBRUQsZUFBZTtRQUNmLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxXQUFXLEVBQUUsRUFBRTtZQUMzQixXQUFXLENBQUMsSUFBSSxHQUFHLFdBQVcsQ0FBQyxJQUFJ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ZUFBZSxFQUFFLGtCQUFrQixDQUFDLENBQUM7SUFFdkQsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDYixNQUFNLENBQUMsS0FBSyxDQUFDLDBDQUEwQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ2hFLE1BQU0sS0FBSyxDQUFDO0lBQ2hCLENBQUM7QUFDTCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLGFBQWEsQ0FBQyxNQUFjLEVBQUUsTUFBYztJQUNqRCxJQUFJLENBQUMsSUFBQSxlQUFVLEVBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztRQUN0QixJQUFBLGNBQVMsRUFBQyxNQUFNLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUMzQyxDQUFDO0lBQ0QsTUFBTSxLQUFLLEdBQUcsSUFBQSxnQkFBVyxFQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ2xDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUU7UUFDakIsTUFBTSxVQUFVLEdBQUcsSUFBQSxXQUFRLEVBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzFDLE1BQU0sVUFBVSxHQUFHLElBQUEsV0FBUSxFQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztRQUMxQyxJQUFJLElBQUEsY0FBUyxFQUFDLFVBQVUsQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7WUFDdEMsYUFBYSxDQUFDLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUMxQyxDQUFDO2FBQU0sQ0FBQztZQUNKLElBQUEsaUJBQVksRUFBQyxVQUFVLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFDekMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENmbk91dHB1dCwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcblxuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmUvaGVscGVyXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgRGVmYXVsdExvZ2dlciwgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciwgSUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBBcmNoaXRlY3R1cmUsIENvZGUsIExheWVyVmVyc2lvbiwgTGF5ZXJWZXJzaW9uUHJvcHMsIFJ1bnRpbWUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IGJhc2VuYW1lIGFzIHBhdGhCYXNlTmFtZSwgcmVzb2x2ZSBhcyBwYXRoUmVzb2x2ZSwgam9pbiBhcyBwYXRoSm9pbiwgZXh0bmFtZSBhcyBwYXRoRXh0bmFtZSwgcmVsYXRpdmUgYXMgcGF0aFJlbGF0aXZlIH0gZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBleGlzdHNTeW5jLCBta2RpclN5bmMsIHJlYWRkaXJTeW5jLCBzdGF0U3luYywgcm1TeW5jLCBsc3RhdFN5bmMsIGNvcHlGaWxlU3luYywgcmVuYW1lU3luYywgcmVhZEZpbGVTeW5jLCB3cml0ZUZpbGVTeW5jIH0gZnJvbSAnZnMnO1xuaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGJ1aWxkLCBCdWlsZE9wdGlvbnMgfSBmcm9tICdlc2J1aWxkJztcbmltcG9ydCB7IExheWVyRW50cnkgfSBmcm9tIFwiLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwiY3J5cHRvXCI7XG5pbXBvcnQgeyBtZXJnZSB9IGZyb20gXCIuLi91dGlscy9tZXJnZVwiO1xuXG5cbi8qKlxuICogQ29tbW9uIGxheWVyIGNvbmZpZ3VyYXRpb24gcHJvcGVydGllc1xuICovXG5pbnRlcmZhY2UgSUJhc2VMYXllckNvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBzb3VyY2UgcGF0aCBvZiB0aGUgbGF5ZXIgZGlyZWN0b3J5IG9yIGZpbGUuXG4gICAgICovXG4gICAgc291cmNlUGF0aDogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgcHJvcGVydGllcyBmb3IgdGhlIGxheWVyIHZlcnNpb24uXG4gICAgICovXG4gICAgbGF5ZXJQcm9wcz86IE9taXQ8TGF5ZXJWZXJzaW9uUHJvcHMsICdjb2RlJz47XG5cbiAgICAvKipcbiAgICAgKiBDdXN0b20gYnVpbGQgb3B0aW9ucyBmb3IgZXNidWlsZCBidW5kbGluZy5cbiAgICAgKiBNZXJnZWQgaW4gcHJpb3JpdHkgb3JkZXI6IGRlZmF1bHRzIDwgY29uc3RydWN0LWxldmVsIDwgZGVjb3JhdG9yLWxldmVsXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiB7XG4gICAgICogICBidWlsZE9wdGlvbnM6IHtcbiAgICAgKiAgICAgc291cmNlbWFwOiB0cnVlLFxuICAgICAqICAgICBtaW5pZnk6IGZhbHNlLFxuICAgICAqICAgICBleHRlcm5hbDogWydAYXdzLXNkaycsICdzb21lLW5hdGl2ZS1tb2R1bGUnXVxuICAgICAqICAgfVxuICAgICAqIH1cbiAgICAgKi9cbiAgICBidWlsZE9wdGlvbnM/OiBCdWlsZE9wdGlvbnM7XG5cbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIHRoaXMgbGF5ZXIgc2hvdWxkIE5PVCBiZSBhZGRlZCBhcyBhIGdsb2JhbCBsYXllci5cbiAgICAgKiBJZiBmYWxzZSBvciB1bmRlZmluZWQsIHRoZSBsYXllciB3aWxsIGJlIGF1dG9tYXRpY2FsbHkgYXR0YWNoZWQgdG8gYWxsIExhbWJkYSBmdW5jdGlvbnMuXG4gICAgICogRGVmYXVsdHMgdG8gZmFsc2UgKGxheWVyIElTIGdsb2JhbCkuXG4gICAgICovXG4gICAgbm90R2xvYmFsPzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIFdoZXRoZXIgdGhpcyBsYXllciBzaG91bGQgYmUgbG9hZGVkIGFzIGFuIGVudHJ5IHBhY2thZ2UgKGNvZGUgZXhlY3V0ZXMgYXQgbW9kdWxlIGluaXRpYWxpemF0aW9uKS5cbiAgICAgKiBJZiBmYWxzZSwgdGhlIGxheWVyIGlzIG9ubHkgYXZhaWxhYmxlIGZvciBpbXBvcnRzIGJ1dCBkb2Vzbid0IGV4ZWN1dGUuXG4gICAgICogRGVmYXVsdHMgdG8gZmFsc2UuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiAvLyBmdzI0IHJ1bnRpbWUgbGF5ZXIgLSBhdmFpbGFibGUgZm9yIGltcG9ydCBidXQgZG9lc24ndCBleGVjdXRlXG4gICAgICogeyBzb3VyY2VQYXRoOiAnLi9mdzI0LmpzJywgaXNFbnRyeVBhY2thZ2U6IGZhbHNlIH1cbiAgICAgKiBcbiAgICAgKiAvLyBkaSBsYXllciAtIGV4ZWN1dGVzIERJQ29udGFpbmVyLlJPT1QubW9kdWxlKCkgYXQgaW5pdFxuICAgICAqIHsgc291cmNlUGF0aDogJy4vZGkudHMnLCBpc0VudHJ5UGFja2FnZTogdHJ1ZSB9XG4gICAgICovXG4gICAgaXNFbnRyeVBhY2thZ2U/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogUHJpb3JpdHkgZm9yIGxheWVyIGxvYWRpbmcgb3JkZXIuIExvd2VyIG51bWJlcnMgbG9hZCBmaXJzdC5cbiAgICAgKiBJZiBub3Qgc3BlY2lmaWVkLCBwcmlvcml0eSBpcyBhdXRvLWFzc2lnbmVkIGFzIChhcnJheV9pbmRleCArIDEwKS5cbiAgICAgKiBcbiAgICAgKiBQcmlvcml0eSByYW5nZXM6XG4gICAgICogLSAwLTk6IFJlc2VydmVkIGZvciBmcmFtZXdvcmsgbGF5ZXJzIChmdzI0IGNvcmUgPSAwKVxuICAgICAqIC0gMTArOiBVc2VyL2FwcGxpY2F0aW9uIGxheWVycyAoYXV0by1hc3NpZ25lZCBvciBleHBsaWNpdClcbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIC8vIEF1dG8tYXNzaWduZWQgcHJpb3JpdGllcyAocmVjb21tZW5kZWQpOlxuICAgICAqIGNvbnN0IGxheWVycyA9IG5ldyBMYXllckNvbnN0cnVjdChbXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2RpLnRzJyB9LCAgICAgICAgLy8gcHJpb3JpdHk6IDEwXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL3NoYXJlZC50cycgfSwgICAgLy8gcHJpb3JpdHk6IDExXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2ZpcmViYXNlLnRzJyB9ICAgLy8gcHJpb3JpdHk6IDEyXG4gICAgICogXSk7XG4gICAgICogXG4gICAgICogLy8gRXhwbGljaXQgcHJpb3JpdGllcyAoZm9yIHNwZWNpYWwgY2FzZXMpOlxuICAgICAqIGNvbnN0IGxheWVycyA9IG5ldyBMYXllckNvbnN0cnVjdChbXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2RpLnRzJywgcHJpb3JpdHk6IDEwIH0sICAgICAgLy8gTG9hZCBmaXJzdFxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9maXJlYmFzZS50cycsIHByaW9yaXR5OiAyMCB9LCAvLyBMb2FkIGxhc3RcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vc2hhcmVkLnRzJywgcHJpb3JpdHk6IDE1IH0gICAvLyBMb2FkIGluIGJldHdlZW5cbiAgICAgKiBdKTtcbiAgICAgKi9cbiAgICBwcmlvcml0eT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB0aGUgUEFDS0FHRV9ESVJFQ1RPUlkgbW9kZS5cbiAqIFBhY2thZ2VzIGEgcHJlLWJ1aWx0IGRpcmVjdG9yeSBhcy1pcyB3aXRob3V0IGJ1bmRsaW5nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElQYWNrYWdlRGlyZWN0b3J5Q29uZmlnIGV4dGVuZHMgSUJhc2VMYXllckNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIG5hbWUgb2YgdGhlIGxheWVyLlxuICAgICAqL1xuICAgIGxheWVyTmFtZTogc3RyaW5nO1xuICAgIFxuICAgIC8qKlxuICAgICAqIFRoZSBtb2RlIG9mIHBhY2thZ2luZzogcGFja2FnZSB0aGUgd2hvbGUgZGlyZWN0b3J5LlxuICAgICAqL1xuICAgIG1vZGU/OiAnUEFDS0FHRV9ESVJFQ1RPUlknO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIHRoZSBCVUlMRF9BTkRfUEFDS0FHRSBtb2RlLlxuICogQnVuZGxlcyBzb3VyY2UgZmlsZXMgd2l0aCBlc2J1aWxkIGJlZm9yZSBwYWNrYWdpbmcuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUJ1aWxkQW5kUGFja2FnZUNvbmZpZyBleHRlbmRzIElCYXNlTGF5ZXJDb25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBtb2RlIG9mIHBhY2thZ2luZzogc2NhbiBhbmQgYnVpbGQgaW5kaXZpZHVhbCBmaWxlcy5cbiAgICAgKi9cbiAgICBtb2RlOiAnQlVJTERfQU5EX1BBQ0tBR0UnO1xuXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgY3VzdG9tIGRpc3RyaWJ1dGlvbiBkaXJlY3RvcnkgZm9yIHRoZSBidWlsZCBvdXRwdXRzLlxuICAgICAqL1xuICAgIGRpc3REaXJlY3Rvcnk/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBGbGFnIHRvIGNsZWFyIHRoZSBvdXRwdXQgZGlyZWN0b3J5IGFmdGVyIHBhY2thZ2luZzsgZGVmYXVsdHMgdG8gZmFsc2UuXG4gICAgICovXG4gICAgY2xlYXJPdXRwdXREaXI/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogQ29uZmlndXJhYmxlIG91dHB1dCBwYXRoIGZvciB0aGUgcGFja2FnZS5cbiAgICAgKi8gXG4gICAgcGFja2FnZVBhdGg/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgbGF5ZXIgY29uc3RydWN0LlxuICogXG4gKiBMYXllcnMgYXJlIHByb2Nlc3NlZCBpbiBwYXJhbGxlbCBmb3Igc3BlZWQsIGJ1dCBsb2FkZWQgYXQgcnVudGltZSBpbiBwcmlvcml0eSBvcmRlci5cbiAqIFByaW9yaXR5IGRldGVybWluZXMgdGhlIG9yZGVyIGluIHdoaWNoIGxheWVycyBpbml0aWFsaXplIHdoZW4gTGFtYmRhIGNvbGQgc3RhcnRzLlxuICogXG4gKiBAc2VlIElCdWlsZEFuZFBhY2thZ2VDb25maWcucHJpb3JpdHkgZm9yIHByaW9yaXR5IGRldGFpbHNcbiAqL1xuZXhwb3J0IHR5cGUgSUxheWVyQ29uc3RydWN0Q29uZmlnID0gSVBhY2thZ2VEaXJlY3RvcnlDb25maWcgfCBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBjb25zdHJ1Y3QgZm9yIGNyZWF0aW5nIExhbWJkYSBsYXllcnMuXG4gKiBcbiAqIExheWVycyBhcmUgYnVpbHQgaW4gcGFyYWxsZWwgZm9yIHBlcmZvcm1hbmNlLCBidXQgaW5pdGlhbGl6ZSBhdCBMYW1iZGEgcnVudGltZVxuICogaW4gcHJpb3JpdHkgb3JkZXIuIFRoaXMgZW5zdXJlcyBjb3JyZWN0IGRlcGVuZGVuY3kgbG9hZGluZyAoZS5nLiwgREkgY29udGFpbmVyXG4gKiBsb2FkcyBiZWZvcmUgbGF5ZXJzIHRoYXQgdXNlIGl0KS5cbiAqIFxuICogUHJpb3JpdHkgU3lzdGVtOlxuICogLSAwLTk6IFJlc2VydmVkIGZvciBmcmFtZXdvcmsgbGF5ZXJzIChmdzI0IGNvcmUgPSAwKVxuICogLSAxMCs6IEFwcGxpY2F0aW9uIGxheWVycyAoYXV0by1hc3NpZ25lZCBzdGFydGluZyBhdCAxMCwgb3Igc2V0IGV4cGxpY2l0bHkpXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogLy8gQmFzaWMgdXNhZ2Ugd2l0aCBhdXRvLXByaW9yaXR5IChyZWNvbW1lbmRlZClcbiAqIGNvbnN0IGRpTGF5ZXIgPSBuZXcgRElMYXllckNvbnN0cnVjdChbXG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2RpLnRzJyB9LCAgICAgICAgICAgICAgLy8gcHJpb3JpdHk6IDEwIChhdXRvKVxuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9jb25maWcvc2hhcmVkLnRzJyB9LCAgIC8vIHByaW9yaXR5OiAxMSAoYXV0bylcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvY29uZmlnL2ZpcmViYXNlLnRzJyB9ICAvLyBwcmlvcml0eTogMTIgKGF1dG8pXG4gKiBdKTtcbiAqIFxuICogLy8gQWR2YW5jZWQgdXNhZ2Ugd2l0aCBleHBsaWNpdCBwcmlvcml0aWVzXG4gKiBjb25zdCBkaUxheWVyID0gbmV3IERJTGF5ZXJDb25zdHJ1Y3QoW1xuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9kaS50cycsIHByaW9yaXR5OiAxMCB9LCAgICAgICAgLy8gTG9hZCBmaXJzdFxuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9jb25maWcvZmlyZWJhc2UudHMnLCBwcmlvcml0eTogMjAgfSwgLy8gTG9hZCBsYXN0XG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2NvbmZpZy9zaGFyZWQudHMnLCBwcmlvcml0eTogMTUgfSAgICAvLyBMb2FkIGluIGJldHdlZW5cbiAqIF0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBMYXllckNvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuICAgIHJlYWRvbmx5IGxvZ2dlcjogSUxvZ2dlcjtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgIFxuICAgIG5hbWUgPSBMYXllckNvbnN0cnVjdC5uYW1lO1xuICAgIGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgbWFpblN0YWNrITogU3RhY2s7XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IExheWVyQ29uc3RydWN0IGluc3RhbmNlLlxuICAgICAqIEBwYXJhbSBjb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIExheWVyQ29uc3RydWN0LlxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgY29uZmlnOiBJTGF5ZXJDb25zdHJ1Y3RDb25maWdbXSwgdmVyYm9zZUxvZyA/OiBudW1iZXIpIHtcblxuICAgICAgICBpZih2ZXJib3NlTG9nKXtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyID0gY3JlYXRlTG9nZ2VyKExheWVyQ29uc3RydWN0Lm5hbWUsIDEpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIgPSBjcmVhdGVMb2dnZXIoTGF5ZXJDb25zdHJ1Y3QubmFtZSk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIGFkZCBkZWZhdWx0c1xuICAgICAgICBjb25maWcuZm9yRWFjaCgobGF5ZXJDb25maWcpID0+IHtcbiAgICAgICAgICAgIGxheWVyQ29uZmlnLm1vZGUgPSBsYXllckNvbmZpZy5tb2RlIHx8ICdQQUNLQUdFX0RJUkVDVE9SWSc7XG4gICAgICAgICAgICBpZiAobGF5ZXJDb25maWcubW9kZSA9PT0gJ0JVSUxEX0FORF9QQUNLQUdFJykge1xuICAgICAgICAgICAgICAgIGxheWVyQ29uZmlnLmNsZWFyT3V0cHV0RGlyID0gbGF5ZXJDb25maWcuY2xlYXJPdXRwdXREaXIgPz8gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKGNvbmZpZywgJ0xBWUVSJyk7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICAvLyBBc3NpZ24gcHJpb3JpdHkgdG8gZWFjaCBsYXllcjogdXNlIGV4cGxpY2l0IHByaW9yaXR5IGlmIHNldCwgb3RoZXJ3aXNlIHVzZSBhcnJheSBpbmRleCArIDEwXG4gICAgICAgIC8vIFByaW9yaXR5IDAtOSByZXNlcnZlZCBmb3IgZnJhbWV3b3JrIGxheWVycyAoZncyNCBjb3JlID0gMClcbiAgICAgICAgLy8gVXNlciBsYXllcnMgc3RhcnQgYXQgMTArIHRvIGVuc3VyZSBmcmFtZXdvcmsgbGF5ZXJzIGFsd2F5cyBsb2FkIGZpcnN0XG4gICAgICAgIHRoaXMuY29uZmlnLmZvckVhY2goKGxheWVyQ29uZmlnLCBpbmRleCkgPT4ge1xuICAgICAgICAgICAgaWYgKCFsYXllckNvbmZpZy5wcmlvcml0eSAmJiBsYXllckNvbmZpZy5wcmlvcml0eSAhPT0gMCkge1xuICAgICAgICAgICAgICAgIGxheWVyQ29uZmlnLnByaW9yaXR5ID0gaW5kZXggKyAxMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUHJvY2VzcyBsYXllcnMgaW4gcGFyYWxsZWwgZm9yIHNwZWVkIHdoaWxlIHJlc3BlY3RpbmcgcHJpb3JpdHktYmFzZWQgbG9hZGluZyBvcmRlclxuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbCh0aGlzLmNvbmZpZy5tYXAoYXN5bmMgKGxheWVyQ29uZmlnKSA9PiB7XG4gICAgICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayhsYXllckNvbmZpZy5zdGFja05hbWUgfHwgdGhpcy5mdzI0LmdldENvbmZpZygpLmxheWVyU3RhY2tOYW1lLCBsYXllckNvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlByb2Nlc3NpbmcgbGF5ZXI6XCIsIGxheWVyQ29uZmlnKTtcblxuICAgICAgICAgICAgaWYgKGxheWVyQ29uZmlnLm1vZGUgPT09ICdQQUNLQUdFX0RJUkVDVE9SWScpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBhY2thZ2VEaXJlY3RvcnkobGF5ZXJDb25maWcpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllckNvbmZpZy5tb2RlID09PSAnQlVJTERfQU5EX1BBQ0tBR0UnKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zY2FuQW5kUGFja2FnZUZpbGVzKGxheWVyQ29uZmlnKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIG1vZGUgZm9yIGxheWVyICR7bGF5ZXJDb25maWd9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQYWNrYWdlcyBhIGRpcmVjdG9yeSBhcyBhIExhbWJkYSBsYXllci5cbiAgICAgKiBAcGFyYW0gbGF5ZXJDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIGxheWVyLlxuICAgICAqIEBwYXJhbSBtYWluU3RhY2sgLSBUaGUgbWFpbiBzdGFjayBmb3IgZGVwbG95aW5nIHJlc291cmNlcy5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHBhY2thZ2VEaXJlY3RvcnkobGF5ZXJDb25maWc6IElQYWNrYWdlRGlyZWN0b3J5Q29uZmlnKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRMYXllclByb3BzOiBMYXllclZlcnNpb25Qcm9wcyA9IHtcbiAgICAgICAgICAgIGxheWVyVmVyc2lvbk5hbWU6IGxheWVyQ29uZmlnLmxheWVyTmFtZSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVSdW50aW1lczogWyBSdW50aW1lLk5PREVKU18yMl9YIF0sXG4gICAgICAgICAgICBjb2RlOiBDb2RlLmZyb21Bc3NldChsYXllckNvbmZpZy5zb3VyY2VQYXRoKSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVBcmNoaXRlY3R1cmVzOiBbQXJjaGl0ZWN0dXJlLkFSTV82NF0sXG4gICAgICAgIH07XG4gICAgICAgIFxuICAgICAgICBjb25zdCBsYXllciA9IG5ldyBMYXllclZlcnNpb24odGhpcy5tYWluU3RhY2ssIGxheWVyQ29uZmlnLmxheWVyTmFtZSArICctbGF5ZXInLCB7XG4gICAgICAgICAgICAuLi5kZWZhdWx0TGF5ZXJQcm9wcyxcbiAgICAgICAgICAgIC4uLmxheWVyQ29uZmlnLmxheWVyUHJvcHMsXG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBsYXllckNvbmZpZy5sYXllck5hbWUsIGxheWVyLCBPdXRwdXRUeXBlLkxBWUVSLCAnbGF5ZXJWZXJzaW9uQXJuJyk7XG5cbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFNjYW5zIGEgZGlyZWN0b3J5IGZvciBUeXBlU2NyaXB0IGZpbGVzIGFuZCBjcmVhdGVzIExhbWJkYSBsYXllcnMgZm9yIHRoZW0uXG4gICAgICogQHBhcmFtIGxheWVyQ29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBsYXllci5cbiAgICAgKiBAcGFyYW0gbWFpblN0YWNrIC0gVGhlIG1haW4gc3RhY2sgZm9yIGRlcGxveWluZyByZXNvdXJjZXMuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBzY2FuQW5kUGFja2FnZUZpbGVzKGxheWVyQ29uZmlnOiBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnKSB7XG4gICAgICAgIC8vIERlZmF1bHQgdG8gYXBwbGljYXRpb24ncyBkaXN0L2xheWVycyBkaXJlY3RvcnkgKHByb2Nlc3MuY3dkKCkgaXMgdGhlIGFwcGxpY2F0aW9uIHJvb3QpXG4gICAgICAgIGNvbnN0IGRpc3REaXJlY3RvcnkgPSBsYXllckNvbmZpZy5kaXN0RGlyZWN0b3J5IHx8IHBhdGhKb2luKHByb2Nlc3MuY3dkKCksICdkaXN0L2xheWVycycpO1xuICAgICAgICBjb25zdCBzb3VyY2VEaXJlY3RvcnlPckZpbGVOYW1lID0gcGF0aFJlc29sdmUobGF5ZXJDb25maWcuc291cmNlUGF0aCk7XG4gICAgICAgIGNvbnN0IHRzRmlsZXMgPSBsc3RhdFN5bmMoc291cmNlRGlyZWN0b3J5T3JGaWxlTmFtZSkuaXNEaXJlY3RvcnkoKVxuICAgICAgICAgICAgPyBzY2FuRGlyZWN0b3J5KHNvdXJjZURpcmVjdG9yeU9yRmlsZU5hbWUpXG4gICAgICAgICAgICA6IFtzb3VyY2VEaXJlY3RvcnlPckZpbGVOYW1lXTtcblxuICAgICAgICAvLyBQcm9jZXNzIGZpbGVzIGluIHBhcmFsbGVsIG5vdyB0aGF0IHdlIGhhdmUgcHJpb3JpdHktYmFzZWQgb3JkZXJpbmdcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwodHNGaWxlcy5tYXAoYXN5bmMgKGZpbGUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMudHJ5Q3JlYXRlTGF5ZXJGb3JGaWxlKGZpbGUsIGRpc3REaXJlY3RvcnksIGxheWVyQ29uZmlnKTtcbiAgICAgICAgfSkpO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogTWVyZ2VzIGJ1aWxkIG9wdGlvbnMgd2l0aCBwcm9wZXIgcHJpb3JpdHk6IGRlZmF1bHRzIDwgY29uc3RydWN0LWxldmVsIDwgZGVjb3JhdG9yLWxldmVsXG4gICAgICogQHBhcmFtIGxheWVyTmFtZSAtIExheWVyIG5hbWUgZm9yIGxvZ2dpbmdcbiAgICAgKiBAcGFyYW0gY29uc3RydWN0QnVpbGRPcHRpb25zIC0gQnVpbGQgb3B0aW9ucyBmcm9tIGNvbnN0cnVjdCBjb25maWdcbiAgICAgKiBAcGFyYW0gZGVjb3JhdG9yQnVpbGRPcHRpb25zIC0gQnVpbGQgb3B0aW9ucyBmcm9tIEBMYXllckVudHJ5IGRlY29yYXRvclxuICAgICAqIEByZXR1cm5zIE1lcmdlZCBidWlsZCBvcHRpb25zXG4gICAgICovXG4gICAgcHJpdmF0ZSBtZXJnZUJ1aWxkT3B0aW9ucyhcbiAgICAgICAgbGF5ZXJOYW1lOiBzdHJpbmcsXG4gICAgICAgIGNvbnN0cnVjdEJ1aWxkT3B0aW9ucz86IEJ1aWxkT3B0aW9ucyxcbiAgICAgICAgZGVjb3JhdG9yQnVpbGRPcHRpb25zPzogQnVpbGRPcHRpb25zXG4gICAgKTogQnVpbGRPcHRpb25zIHtcbiAgICAgICAgLy8gRGVmYXVsdCBidWlsZCBvcHRpb25zIGZvciBhbGwgbGF5ZXJzXG4gICAgICAgIGNvbnN0IGRlZmF1bHRCdWlsZE9wdGlvbnM6IEJ1aWxkT3B0aW9ucyA9IHtcbiAgICAgICAgICAgIGJ1bmRsZTogdHJ1ZSxcbiAgICAgICAgICAgIHBsYXRmb3JtOiAnbm9kZScsXG4gICAgICAgICAgICB0YXJnZXQ6ICdub2RlMTgnLFxuICAgICAgICAgICAgbWluaWZ5OiBmYWxzZSxcbiAgICAgICAgICAgIHNvdXJjZW1hcDogZmFsc2UsXG4gICAgICAgICAgICBleHRlcm5hbDogW1xuICAgICAgICAgICAgICAgIC8vIEZyYW1ld29yayBydW50aW1lIHByb3ZpZGVkIGJ5IHNlcGFyYXRlIGZ3MjQgbGF5ZXJcbiAgICAgICAgICAgICAgICAnQHRlbjI0Z3JvdXAvZncyNCcsXG4gICAgICAgICAgICAgICAgLy8gQVdTIFNESyBhbmQgYnVpbGQgdG9vbHNcbiAgICAgICAgICAgICAgICAnQGF3cy1zZGsnLFxuICAgICAgICAgICAgICAgICdAc21pdGh5JyxcbiAgICAgICAgICAgICAgICAnYXdzLWNkay1saWInLFxuICAgICAgICAgICAgICAgICdlc2J1aWxkJyxcbiAgICAgICAgICAgIF1cbiAgICAgICAgfTtcblxuICAgICAgICAvLyBNZXJnZSBpbiBwcmlvcml0eSBvcmRlciB1c2luZyBkZWVwIG1lcmdlXG4gICAgICAgIGNvbnN0IG1lcmdlZCA9IChtZXJnZShbXG4gICAgICAgICAgICBkZWZhdWx0QnVpbGRPcHRpb25zLFxuICAgICAgICAgICAgY29uc3RydWN0QnVpbGRPcHRpb25zIHx8IHt9LFxuICAgICAgICAgICAgZGVjb3JhdG9yQnVpbGRPcHRpb25zIHx8IHt9XG4gICAgICAgIF0pIHx8IGRlZmF1bHRCdWlsZE9wdGlvbnMpIGFzIEJ1aWxkT3B0aW9ucztcblxuICAgICAgICAvLyBMb2cgbWVyZ2VkIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFske2xheWVyTmFtZX1dIEJ1aWxkIG9wdGlvbnMgbWVyZ2VkOmAsIHtcbiAgICAgICAgICAgIHNvdXJjZW1hcDogbWVyZ2VkLnNvdXJjZW1hcCxcbiAgICAgICAgICAgIG1pbmlmeTogbWVyZ2VkLm1pbmlmeSxcbiAgICAgICAgICAgIGV4dGVybmFsOiBtZXJnZWQuZXh0ZXJuYWwsXG4gICAgICAgICAgICBwbGF0Zm9ybTogbWVyZ2VkLnBsYXRmb3JtLFxuICAgICAgICAgICAgdGFyZ2V0OiBtZXJnZWQudGFyZ2V0XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBtZXJnZWQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQXR0ZW1wdHMgdG8gY3JlYXRlIGEgTGFtYmRhIGxheWVyIGZvciBhIGdpdmVuIFR5cGVTY3JpcHQgZmlsZS5cbiAgICAgKiBAcGFyYW0gZmlsZSAtIFRoZSBwYXRoIHRvIHRoZSBUeXBlU2NyaXB0IGZpbGUuXG4gICAgICogQHBhcmFtIGRpc3REaXJlY3RvcnkgLSBUaGUgb3V0cHV0IGRpcmVjdG9yeSBmb3IgdGhlIGJ1aWxkLlxuICAgICAqIEBwYXJhbSBtYWluU3RhY2sgLSBUaGUgbWFpbiBzdGFjayBmb3IgZGVwbG95aW5nIHJlc291cmNlcy5cbiAgICAgKiBAcGFyYW0gbGF5ZXJDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIGxheWVyLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgdHJ5Q3JlYXRlTGF5ZXJGb3JGaWxlKGZpbGU6IHN0cmluZywgZGlzdERpcmVjdG9yeTogc3RyaW5nLCBsYXllckNvbmZpZzogSUJ1aWxkQW5kUGFja2FnZUNvbmZpZykge1xuICAgICAgICBjb25zdCBmaWxlQmFzZU5hbWUgPSBwYXRoQmFzZU5hbWUoZmlsZSwgcGF0aEV4dG5hbWUoZmlsZSkpO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBQcm9jZXNzaW5nIGxheWVyOiAke2ZpbGVCYXNlTmFtZX1gKTtcbiAgICAgICAgXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBMb2FkaW5nIGxheWVyIGRlc2NyaXB0b3IgZnJvbSAke2ZpbGV9Li4uYCk7XG4gICAgICAgIGNvbnN0IG1vZHVsZUV4cG9ydHMgPSBhd2FpdCBpbXBvcnQoZmlsZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBMYXllciBkZXNjcmlwdG9yIGxvYWRlZGApO1xuXG4gICAgICAgIGNvbnN0IGZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSA9IE9iamVjdC5rZXlzKG1vZHVsZUV4cG9ydHMpLmZpbmQoKGtleSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZXhwb3J0ZWQgPSBtb2R1bGVFeHBvcnRzW2tleV07XG4gICAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydGVkID09PSAnZnVuY3Rpb24nICYmIGlzTGF5ZXJFbnRyeShleHBvcnRlZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhwb3J0ZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICBcbiAgICAgICAgaWYoIWZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSl7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBMYXllckVudHJ5IGZvdW5kIGluIGZpbGUgJHtmaWxlfS4gV2lsbCB1c2UgRGVmYXVsdCBvcHRpb25zLmApO1xuICAgICAgICB9XG5cbiAgICAgICAgTGF5ZXJFbnRyeSh7IFxuICAgICAgICAgICAgbm90R2xvYmFsOiBsYXllckNvbmZpZy5ub3RHbG9iYWwgPz8gZmFsc2UsXG4gICAgICAgICAgICBpc0VudHJ5UGFja2FnZTogbGF5ZXJDb25maWcuaXNFbnRyeVBhY2thZ2UgPz8gZmFsc2VcbiAgICAgICAgfSlcbiAgICAgICAgY2xhc3MgRW1wdHlMYXllckRlc2NyaXB0b3Ige31cblxuICAgICAgICAvLyBpZiBubyBsYXllciBkZXNjcmlwdG9yIGZvdW5kIGluIHRoZSBmaWxlLCBjcmVhdGUgYW4gZW1wdHkgY2xhc3Mgd2hpY2ggd2lsbCB1c2UgZGVmYXVsdCBvcHRpb25zXG4gICAgICAgIGNvbnN0IGxheWVyRGVzY3JpcHRvciA9IGZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSA/IG1vZHVsZUV4cG9ydHNbZm91bmRMYXllckRlc2NyaXB0b3JOYW1lXSA6IEVtcHR5TGF5ZXJEZXNjcmlwdG9yO1xuXG4gICAgICAgIGNvbnN0IGxheWVyTmFtZSA9IGdldExheWVyTmFtZShsYXllckRlc2NyaXB0b3IpIHx8IGZpbGVCYXNlTmFtZTtcbiAgICAgICAgXG4gICAgICAgIC8vIE1lcmdlIGJ1aWxkIG9wdGlvbnM6IGRlZmF1bHRzIDwgY29uc3RydWN0LWxldmVsIDwgZGVjb3JhdG9yLWxldmVsXG4gICAgICAgIGNvbnN0IGRlY29yYXRvckJ1aWxkT3B0aW9ucyA9IGdldExheWVyQnVpbGRPcHRpb25zKGxheWVyRGVzY3JpcHRvcik7XG4gICAgICAgIGNvbnN0IGJ1aWxkT3B0aW9ucyA9IHRoaXMubWVyZ2VCdWlsZE9wdGlvbnMoXG4gICAgICAgICAgICBsYXllck5hbWUsXG4gICAgICAgICAgICBsYXllckNvbmZpZy5idWlsZE9wdGlvbnMsXG4gICAgICAgICAgICBkZWNvcmF0b3JCdWlsZE9wdGlvbnNcbiAgICAgICAgKTtcbiAgICAgICAgXG4gICAgICAgIC8vIERldGVybWluZSBwYWNrYWdlIHN0cnVjdHVyZTpcbiAgICAgICAgLy8gLSBJZiBwYWNrYWdlUGF0aCBpcyBzZXQ6IHVzZSBpdCBhcyB0aGUgZnVsbCBtb2R1bGUgcGF0aCAoZS5nLiwgQHRlbjI0Z3JvdXAvZncyNClcbiAgICAgICAgLy8gLSBJZiBub3Qgc2V0OiB1c2UgZmlsZUJhc2VOYW1lIGFzIHRoZSBwYWNrYWdlIG5hbWUgKGUuZy4sIGRpLCBzaGFyZWQpXG4gICAgICAgIGNvbnN0IHBhY2thZ2VOYW1lID0gbGF5ZXJDb25maWcucGFja2FnZVBhdGggfHwgZmlsZUJhc2VOYW1lO1xuICAgICAgICBjb25zdCBjb25maWd1cmVkT3V0cHV0UGF0aCA9IGBub2RlanMvbm9kZV9tb2R1bGVzLyR7cGFja2FnZU5hbWV9YDtcbiAgICBcbiAgICAgICAgY29uc3Qgb3V0cHV0RGlyID0gcGF0aEpvaW4oZGlzdERpcmVjdG9yeSwgbGF5ZXJOYW1lLCBjb25maWd1cmVkT3V0cHV0UGF0aCk7XG4gICAgICAgIGNvbnN0IGJ1bmRsZURpciA9IHBhdGhKb2luKGRpc3REaXJlY3RvcnksIGxheWVyTmFtZSk7XG5cbiAgICAgICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgICAgIC8vIEJVSUxEIExBWUVSOiBlc2J1aWxkICsgbnBtIGluc3RhbGwgKHdpdGggbnBtIGluc3RhbGwgY2FjaGluZylcbiAgICAgICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIEJ1aWxkaW5nIGxheWVyLi4uYCk7XG4gICAgICAgIGNvbnN0IGJ1aWxkU3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgICAgICAvLyBFbnN1cmUgb3V0cHV0IGRpcmVjdG9yeSBleGlzdHNcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKG91dHB1dERpcikpIHtcbiAgICAgICAgICAgIG1rZGlyU3luYyhvdXRwdXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSW5zdGFsbCBleHRlcm5hbCBkZXBlbmRlbmNpZXMgRklSU1QgKHdpdGggc21hcnQgY2FjaGluZyB0byBza2lwIGlmIHVuY2hhbmdlZClcbiAgICAgICAgY29uc3QgZXh0ZXJuYWxQYWNrYWdlcyA9IChidWlsZE9wdGlvbnMuZXh0ZXJuYWwgJiYgQXJyYXkuaXNBcnJheShidWlsZE9wdGlvbnMuZXh0ZXJuYWwpKSA/IGJ1aWxkT3B0aW9ucy5leHRlcm5hbCA6IFtdO1xuICAgICAgICBpZiAoZXh0ZXJuYWxQYWNrYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBbMS8yXSBJbnN0YWxsaW5nIGV4dGVybmFsIGRlcGVuZGVuY2llcy4uLmApO1xuICAgICAgICAgICAgYXdhaXQgaW5zdGFsbEV4dGVybmFsRGVwZW5kZW5jaWVzT3B0aW1pemVkKGJ1bmRsZURpciwgZXh0ZXJuYWxQYWNrYWdlcywgdGhpcy5sb2dnZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVGhlbiBidW5kbGUgYXBwbGljYXRpb24gY29kZSBpbnRvIG5vZGVfbW9kdWxlc1xuICAgICAgICBjb25zdCBvdXRwdXRGaWxlID0gcGF0aEpvaW4ob3V0cHV0RGlyLCAnaW5kZXguanMnKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gWzIvMl0gQnVuZGxpbmcgd2l0aCBlc2J1aWxkLi4uYCk7XG4gICAgICAgIGF3YWl0IGJ1bmRsZVdpdGhFc2J1aWxkKGZpbGUsIG91dHB1dEZpbGUsIGJ1aWxkT3B0aW9ucyk7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBlbGFwc2VkID0gKChEYXRlLm5vdygpIC0gYnVpbGRTdGFydFRpbWUpIC8gMTAwMCkudG9GaXhlZCgxKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0g4pyTIEJ1aWxkIGNvbXBsZXRlIGluICR7ZWxhcHNlZH1zYClcblxuICAgICAgICAvLyBJbXBvcnQgcGF0aDogL29wdC9ub2RlanMvbm9kZV9tb2R1bGVzL3twYWNrYWdlTmFtZX0vaW5kZXguanNcbiAgICAgICAgLy8gTm9kZS5qcyB3aWxsIHJlc29sdmUgdGhpcyB0byB0aGUgYnVuZGxlZCBlbnRyeSBwb2ludFxuICAgICAgICBjb25zdCBsYXllckltcG9ydFBhdGggPSBwYXRoSm9pbignL29wdCcsIGNvbmZpZ3VyZWRPdXRwdXRQYXRoLCAnaW5kZXguanMnKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gTGF5ZXIgaW1wb3J0IHBhdGg6ICR7bGF5ZXJJbXBvcnRQYXRofWApO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGxheWVyTmFtZSwgbGF5ZXJJbXBvcnRQYXRoLCAnbGF5ZXJJbXBvcnRQYXRoJyk7XG5cbiAgICAgICAgaWYoaXNHbG9iYWxMYXllcihsYXllckRlc2NyaXB0b3IpKXtcbiAgICAgICAgICAgIC8vIEF0dGFjaCB0aGlzIGxheWVyIHRvIGFsbCBMYW1iZGEgZnVuY3Rpb25zXG4gICAgICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyhsYXllck5hbWUpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBPbmx5IGFkZCBhcyBlbnRyeSBwYWNrYWdlIGlmIGl0IG5lZWRzIHRvIGV4ZWN1dGUgYXQgbW9kdWxlIGluaXRpYWxpemF0aW9uXG4gICAgICAgICAgICBpZiAoaXNFbnRyeVBhY2thZ2UobGF5ZXJEZXNjcmlwdG9yKSkge1xuICAgICAgICAgICAgLy8gY29sbGVjdCBnbG9iYWwgZW50cnktcGFja2FnZXMgZm9yIGxhbWJkYXMgd2l0aCBwcmlvcml0eSBmb3IgY29ycmVjdCBsb2FkaW5nIG9yZGVyXG4gICAgICAgICAgICAvLyBQcmlvcml0eSBpcyBhbHdheXMgc2V0IGluIGNvbnN0cnVjdCgpLCBzbyBpdCBtdXN0IGJlIGRlZmluZWQgaGVyZVxuICAgICAgICAgICAgaWYgKGxheWVyQ29uZmlnLnByaW9yaXR5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYExheWVyICR7bGF5ZXJOYW1lfSBoYXMgbm8gcHJpb3JpdHkuIFRoaXMgc2hvdWxkIG5ldmVyIGhhcHBlbi5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuZncyNC5hZGRHbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2UoYGVudjpsYXllckltcG9ydFBhdGg6JHtsYXllck5hbWV9YCwgbGF5ZXJDb25maWcucHJpb3JpdHkpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIFJlZ2lzdGVyZWQgYXMgZW50cnkgcGFja2FnZSAocHJpb3JpdHk6ICR7bGF5ZXJDb25maWcucHJpb3JpdHl9KWApO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBMYXllciBhdHRhY2hlZCBidXQgTk9UIGFuIGVudHJ5IHBhY2thZ2UgKGF2YWlsYWJsZSBmb3IgaW1wb3J0IG9ubHkpYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYXllclByb3BzID0gZ2V0TGF5ZXJQcm9wcyhsYXllckRlc2NyaXB0b3IpO1xuXG4gICAgICAgIGNvbnN0IGRlZmF1bHRMYXllclByb3BzOiBMYXllclZlcnNpb25Qcm9wcyA9IHtcbiAgICAgICAgICAgIGxheWVyVmVyc2lvbk5hbWU6IGxheWVyTmFtZSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVSdW50aW1lczogWyBSdW50aW1lLk5PREVKU18yMl9YIF0sXG4gICAgICAgICAgICBjb2RlOiBDb2RlLmZyb21Bc3NldChidW5kbGVEaXIpLFxuICAgICAgICAgICAgY29tcGF0aWJsZUFyY2hpdGVjdHVyZXM6IFtBcmNoaXRlY3R1cmUuQVJNXzY0XSxcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBsYXllciA9IG5ldyBMYXllclZlcnNpb24odGhpcy5tYWluU3RhY2ssIGxheWVyTmFtZSArICctbGF5ZXInLCB7XG4gICAgICAgICAgICAuLi5kZWZhdWx0TGF5ZXJQcm9wcyxcbiAgICAgICAgICAgIC4uLmxheWVyQ29uZmlnLmxheWVyUHJvcHMsXG4gICAgICAgICAgICAuLi5sYXllclByb3BzLCAvLyB0aGUgbGF5ZXJQcm9wcyBmcm9tIHRoZSBkZWNvcmF0b3IgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgbGF5ZXJOYW1lLCBsYXllciwgT3V0cHV0VHlwZS5MQVlFUiwgJ2xheWVyVmVyc2lvbkFybicpO1xuXG4gICAgICAgIC8vIENsZWFuIHVwIHRoZSB0ZW1wb3Jhcnkgb3V0cHV0IGRpcmVjdG9yeSBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmIChsYXllckNvbmZpZy5jbGVhck91dHB1dERpcikge1xuICAgICAgICAgICAgY2xlYW51cERpcmVjdG9yeShvdXRwdXREaXIpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IHNjYW5zIGEgZGlyZWN0b3J5IGFuZCByZXR1cm5zIGEgbGlzdCBvZiBUeXBlU2NyaXB0IGZpbGVzLlxuICogQHBhcmFtIGRpcmVjdG9yeSAtIFRoZSBkaXJlY3RvcnkgdG8gc2Nhbi5cbiAqIEByZXR1cm5zIEFuIGFycmF5IG9mIFR5cGVTY3JpcHQgZmlsZSBwYXRocy5cbiAqL1xuZnVuY3Rpb24gc2NhbkRpcmVjdG9yeShkaXJlY3Rvcnk6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBsZXQgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgaXRlbXMgPSByZWFkZGlyU3luYyhkaXJlY3RvcnkpO1xuXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gcGF0aEpvaW4oZGlyZWN0b3J5LCBpdGVtKTtcbiAgICAgICAgY29uc3Qgc3RhdCA9IHN0YXRTeW5jKGZ1bGxQYXRoKTtcblxuICAgICAgICBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBmaWxlcyA9IGZpbGVzLmNvbmNhdChzY2FuRGlyZWN0b3J5KGZ1bGxQYXRoKSk7XG4gICAgICAgIH0gZWxzZSBpZiAoc3RhdC5pc0ZpbGUoKSAmJiBmdWxsUGF0aC5lbmRzV2l0aCgnLnRzJykpIHtcbiAgICAgICAgICAgIGZpbGVzLnB1c2goZnVsbFBhdGgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbGVzO1xufVxuXG5mdW5jdGlvbiBpc0xheWVyRW50cnkodGFyZ2V0OiBGdW5jdGlvbik6IGJvb2xlYW4ge1xuICAgIHJldHVybiAhIWdldExheWVyTmFtZSh0YXJnZXQpO1xufVxuXG5mdW5jdGlvbiBpc0dsb2JhbExheWVyKHRhcmdldDogRnVuY3Rpb24pOiBib29sZWFuIHtcbiAgICByZXR1cm4gIVJlZmxlY3QuZ2V0KHRhcmdldCwgJ25vdEdsb2JhbCcpO1xufVxuXG5mdW5jdGlvbiBpc0VudHJ5UGFja2FnZSh0YXJnZXQ6IEZ1bmN0aW9uKTogYm9vbGVhbiB7XG4gICAgY29uc3QgdmFsdWUgPSBSZWZsZWN0LmdldCh0YXJnZXQsICdpc0VudHJ5UGFja2FnZScpO1xuICAgIC8vIERlZmF1bHQgdG8gdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXG4gICAgcmV0dXJuIHZhbHVlICE9PSBmYWxzZTtcbn1cblxuZnVuY3Rpb24gZ2V0TGF5ZXJOYW1lKHRhcmdldDogRnVuY3Rpb24pIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGFyZ2V0LCAnbGF5ZXJOYW1lJyk7XG59XG5cbmZ1bmN0aW9uIGdldExheWVyQnVpbGRPcHRpb25zKHRhcmdldDogRnVuY3Rpb24pOiBCdWlsZE9wdGlvbnMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsICdidWlsZE9wdGlvbnMnKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldExheWVyUHJvcHModGFyZ2V0OiBGdW5jdGlvbik6IExheWVyVmVyc2lvblByb3BzIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGFyZ2V0LCAnbGF5ZXJQcm9wcycpO1xufVxuXG4vKipcbiAqIEJ1bmRsZXMgYSBUeXBlU2NyaXB0IGZpbGUgdXNpbmcgZXNidWlsZCB3aXRoIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICogQnVpbGQgb3B0aW9ucyBzaG91bGQgYWxyZWFkeSBiZSBtZXJnZWQgdmlhIG1lcmdlQnVpbGRPcHRpb25zKCkuXG4gKiBAcGFyYW0gZW50cnlGaWxlIC0gVGhlIGVudHJ5IGZpbGUgdG8gYnVuZGxlLlxuICogQHBhcmFtIG91dHB1dEZpbGUgLSBUaGUgb3V0cHV0IGZpbGUgcGF0aCBmb3IgdGhlIGJ1bmRsZS5cbiAqIEBwYXJhbSBidWlsZE9wdGlvbnMgLSBQcmUtbWVyZ2VkIGJ1aWxkIG9wdGlvbnMgZm9yIGVzYnVpbGQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGJ1bmRsZVdpdGhFc2J1aWxkKGVudHJ5RmlsZTogc3RyaW5nLCBvdXRwdXRGaWxlOiBzdHJpbmcsIGJ1aWxkT3B0aW9uczogQnVpbGRPcHRpb25zKSB7XG4gICAgY29uc3QgZmluYWxPcHRpb25zOiBCdWlsZE9wdGlvbnMgPSB7XG4gICAgICAgIC4uLmJ1aWxkT3B0aW9ucyxcbiAgICAgICAgb3V0ZmlsZTogb3V0cHV0RmlsZSxcbiAgICAgICAgZW50cnlQb2ludHM6IFtlbnRyeUZpbGVdLFxuICAgIH07XG5cbiAgICBEZWZhdWx0TG9nZ2VyLmRlYnVnKGBidW5kbGVXaXRoRXNidWlsZDogJHtlbnRyeUZpbGV9IOKGkiAke291dHB1dEZpbGV9YCk7XG4gICAgXG4gICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgYnVpbGQoZmluYWxPcHRpb25zKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gYnVuZGxlICR7ZW50cnlGaWxlfTpgLCBlcnJvcik7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgZXNidWlsZCBmYWlsZWQgZm9yICR7ZW50cnlGaWxlfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgfVxufVxuXG4vKipcbiAqIENhbGN1bGF0ZXMgaGFzaCBvZiBhIGZpbGUncyBjb250ZW50c1xuICovXG5mdW5jdGlvbiBjYWxjdWxhdGVGaWxlSGFzaChmaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBjb250ZW50ID0gcmVhZEZpbGVTeW5jKGZpbGVQYXRoKTtcbiAgICByZXR1cm4gY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKGNvbnRlbnQpLmRpZ2VzdCgnaGV4Jyk7XG59XG5cbi8qKlxuICogSGFzaGVzIGEgZGlyZWN0b3J5J3MgY29udGVudHMgcmVjdXJzaXZlbHkgZm9yIGNoYW5nZSBkZXRlY3Rpb25cbiAqIFVzZWQgZm9yIGxvY2FsIHBhY2thZ2UgZGVwZW5kZW5jaWVzIHRvIGRldGVjdCB3aGVuIHRoZXkndmUgYmVlbiByZWJ1aWx0XG4gKiBAcGFyYW0gZGlyUGF0aCAtIERpcmVjdG9yeSB0byBoYXNoICh0eXBpY2FsbHkgYSBkaXN0IGZvbGRlcilcbiAqIEByZXR1cm5zIFNIQS0yNTYgaGFzaCBvZiBhbGwgZmlsZSBjb250ZW50c1xuICovXG5mdW5jdGlvbiBoYXNoRGlyZWN0b3J5Q29udGVudHMoZGlyUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBoYXNoID0gY3JlYXRlSGFzaCgnc2hhMjU2Jyk7XG4gICAgXG4gICAgY29uc3QgaGFzaERpclJlY3Vyc2l2ZSA9IChjdXJyZW50UGF0aDogc3RyaW5nKSA9PiB7XG4gICAgICAgIGlmICghZXhpc3RzU3luYyhjdXJyZW50UGF0aCkpIHJldHVybjtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHN0YXQgPSBsc3RhdFN5bmMoY3VycmVudFBhdGgpO1xuICAgICAgICBcbiAgICAgICAgaWYgKHN0YXQuaXNTeW1ib2xpY0xpbmsoKSkge1xuICAgICAgICAgICAgLy8gU2tpcCBzeW1saW5rcyB0byBhdm9pZCBpbmZpbml0ZSBsb29wc1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBjb25zdCBpdGVtcyA9IHJlYWRkaXJTeW5jKGN1cnJlbnRQYXRoKS5zb3J0KCk7IC8vIFNvcnQgZm9yIGRldGVybWluaXN0aWMgaGFzaGluZ1xuICAgICAgICAgICAgaXRlbXMuZm9yRWFjaChpdGVtID0+IHtcbiAgICAgICAgICAgICAgICAvLyBTa2lwIGNvbW1vbiBkaXJlY3RvcmllcyB0aGF0IGRvbid0IGFmZmVjdCBydW50aW1lXG4gICAgICAgICAgICAgICAgaWYgKGl0ZW0gPT09ICdub2RlX21vZHVsZXMnIHx8IGl0ZW0gPT09ICcuZ2l0JyB8fCBpdGVtID09PSAndGVzdCcgfHwgaXRlbSA9PT0gJ19fdGVzdHNfXycgfHwgaXRlbSA9PT0gJ2NvdmVyYWdlJykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGhhc2hEaXJSZWN1cnNpdmUocGF0aEpvaW4oY3VycmVudFBhdGgsIGl0ZW0pKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2UgaWYgKHN0YXQuaXNGaWxlKCkpIHtcbiAgICAgICAgICAgIC8vIEhhc2ggZmlsZSBwYXRoIChyZWxhdGl2ZSkgZm9yIHVuaXF1ZW5lc3NcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHBhdGhSZWxhdGl2ZShkaXJQYXRoLCBjdXJyZW50UGF0aCk7XG4gICAgICAgICAgICBoYXNoLnVwZGF0ZShyZWxhdGl2ZVBhdGgpO1xuICAgICAgICAgICAgLy8gSGFzaCBmaWxlIGNvbnRlbnRzXG4gICAgICAgICAgICBoYXNoLnVwZGF0ZShyZWFkRmlsZVN5bmMoY3VycmVudFBhdGgpKTtcbiAgICAgICAgfVxuICAgIH07XG4gICAgXG4gICAgaGFzaERpclJlY3Vyc2l2ZShkaXJQYXRoKTtcbiAgICByZXR1cm4gaGFzaC5kaWdlc3QoJ2hleCcpO1xufVxuXG5cbi8qKlxuICogQ2xlYW5zIHVwIGEgdGVtcG9yYXJ5IGRpcmVjdG9yeSBieSByZW1vdmluZyBhbGwgZmlsZXMgYW5kIHN1YmRpcmVjdG9yaWVzLlxuICogQHBhcmFtIGRpcmVjdG9yeSAtIFRoZSBkaXJlY3RvcnkgdG8gY2xlYW4gdXAuXG4gKi9cbmZ1bmN0aW9uIGNsZWFudXBEaXJlY3RvcnkoZGlyZWN0b3J5OiBzdHJpbmcpIHtcbiAgICB0cnkge1xuICAgICAgICBybVN5bmMoZGlyZWN0b3J5LCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgYnVuZGxlV2l0aEVzYnVpbGQ6IENsZWFuZWQgdXAgdGVtcG9yYXJ5IGRpcmVjdG9yeTogJHtkaXJlY3Rvcnl9YCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5lcnJvcihgYnVuZGxlV2l0aEVzYnVpbGQ6IEZhaWxlZCB0byBjbGVhbiB1cCBkaXJlY3RvcnkgJHtkaXJlY3Rvcnl9OmAsIGVycm9yKTtcbiAgICB9XG59XG5cbi8qKlxuICogT1BUSU1JWkVEOiBJbnN0YWxscyBleHRlcm5hbCBkZXBlbmRlbmNpZXMgd2l0aCBpbnRlbGxpZ2VudCBjYWNoaW5nXG4gKiBcbiAqIEBwYXJhbSBsYXllck91dHB1dERpciAtIFRoZSBPVVRQVVQgZGlyZWN0b3J5IGZvciB0aGUgbGF5ZXIgKGUuZy4sIGRpc3QvbGF5ZXJzL2RpKVxuICogQHBhcmFtIGV4dGVybmFsUGFja2FnZXMgLSBBcnJheSBvZiBwYWNrYWdlIG5hbWVzIHRvIGluc3RhbGwgKGUuZy4sIFsnYXhpb3MnLCAnZmlyZWJhc2UtYWRtaW4nXSlcbiAqIEBwYXJhbSBsb2dnZXIgLSBMb2dnZXIgaW5zdGFuY2UgZm9yIG91dHB1dFxuICovXG5hc3luYyBmdW5jdGlvbiBpbnN0YWxsRXh0ZXJuYWxEZXBlbmRlbmNpZXNPcHRpbWl6ZWQobGF5ZXJPdXRwdXREaXI6IHN0cmluZywgZXh0ZXJuYWxQYWNrYWdlczogKHN0cmluZyB8IFJlZ0V4cClbXSwgbG9nZ2VyOiBhbnkpIHtcbiAgICAvLyBGaWx0ZXIgb3V0IHJlZ2V4IHBhdHRlcm5zLCBmcmFtZXdvcmsgcGFja2FnZXMsIGFuZCBwYWNrYWdlcyBwcm92aWRlZCBieSBvdGhlciBsYXllcnNcbiAgICBjb25zdCBwYWNrYWdlTmFtZXMgPSBleHRlcm5hbFBhY2thZ2VzLmZpbHRlcihwa2cgPT4gXG4gICAgICAgIHR5cGVvZiBwa2cgPT09ICdzdHJpbmcnICYmIFxuICAgICAgICAhcGtnLnN0YXJ0c1dpdGgoJ0Bhd3Mtc2RrJykgJiYgICAgICAvLyBQcm92aWRlZCBieSBMYW1iZGEgcnVudGltZVxuICAgICAgICAhcGtnLnN0YXJ0c1dpdGgoJ0BzbWl0aHknKSAmJiAgICAgICAvLyBQcm92aWRlZCBieSBMYW1iZGEgcnVudGltZVxuICAgICAgICAhcGtnLnN0YXJ0c1dpdGgoJ2F3cy1jZGstbGliJykgJiYgICAvLyBCdWlsZC10aW1lIG9ubHlcbiAgICAgICAgcGtnICE9PSAnZXNidWlsZCcgJiYgICAgICAgICAgICAgICAgLy8gQnVpbGQtdGltZSBvbmx5XG4gICAgICAgIHBrZyAhPT0gJ0B0ZW4yNGdyb3VwL2Z3MjQnICAgICAgICAgIC8vIFByb3ZpZGVkIGJ5IGZ3MjQgcnVudGltZSBsYXllclxuICAgICkgYXMgc3RyaW5nW107XG5cbiAgICBpZiAocGFja2FnZU5hbWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgbm9kZWpzRGlyID0gcGF0aEpvaW4obGF5ZXJPdXRwdXREaXIsICdub2RlanMnKTtcbiAgICBjb25zdCBub2RlTW9kdWxlc0RpciA9IHBhdGhKb2luKG5vZGVqc0RpciwgJ25vZGVfbW9kdWxlcycpO1xuICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHBhdGhKb2luKG5vZGVqc0RpciwgJ3BhY2thZ2UuanNvbicpO1xuICAgIGNvbnN0IHBhY2thZ2VIYXNoUGF0aCA9IHBhdGhKb2luKG5vZGVqc0RpciwgJy5wYWNrYWdlLWhhc2gnKTtcbiAgICBcbiAgICAvLyBCdWlsZCBkZXNpcmVkIHBhY2thZ2UuanNvblxuICAgIGNvbnN0IHBhY2thZ2VKc29uOiBhbnkgPSB7XG4gICAgICAgIG5hbWU6ICdsYXllci1kZXBlbmRlbmNpZXMnLFxuICAgICAgICB2ZXJzaW9uOiAnMS4wLjAnLFxuICAgICAgICBkZXBlbmRlbmNpZXM6IHt9XG4gICAgfTtcblxuICAgIC8vIFJlYWQgdGhlIHByb2plY3QncyBwYWNrYWdlLmpzb24gdG8gZ2V0IHZlcnNpb24gbnVtYmVyc1xuICAgIGNvbnN0IHByb2plY3RSb290ID0gcGF0aFJlc29sdmUocHJvY2Vzcy5jd2QoKSk7XG4gICAgY29uc3QgcHJvamVjdFBhY2thZ2VKc29uUGF0aCA9IHBhdGhKb2luKHByb2plY3RSb290LCAncGFja2FnZS5qc29uJyk7XG4gICAgXG4gICAgLy8gVHJhY2sgbG9jYWwgcGFja2FnZSBjb250ZW50IGhhc2hlcyBmb3IgY2hhbmdlIGRldGVjdGlvblxuICAgIGNvbnN0IGxvY2FsUGFja2FnZUhhc2hlczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICAgIFxuICAgIGlmICghZXhpc3RzU3luYyhwcm9qZWN0UGFja2FnZUpzb25QYXRoKSkge1xuICAgICAgICBsb2dnZXIud2FybihgcGFja2FnZS5qc29uIG5vdCBmb3VuZCBhdCAke3Byb2plY3RQYWNrYWdlSnNvblBhdGh9LCBpbnN0YWxsaW5nIGxhdGVzdCB2ZXJzaW9uc2ApO1xuICAgICAgICBwYWNrYWdlTmFtZXMuZm9yRWFjaChwa2cgPT4ge1xuICAgICAgICAgICAgcGFja2FnZUpzb24uZGVwZW5kZW5jaWVzW3BrZ10gPSAnbGF0ZXN0JztcbiAgICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgcHJvamVjdFBhY2thZ2VKc29uID0gSlNPTi5wYXJzZShyZWFkRmlsZVN5bmMocHJvamVjdFBhY2thZ2VKc29uUGF0aCwgJ3V0Zi04JykpO1xuICAgICAgICAvLyBPTkxZIHVzZSBydW50aW1lIGRlcGVuZGVuY2llcyAtIGRldkRlcGVuZGVuY2llcyBhcmUgYnVpbGQtdGltZSB0b29scywgbm90IExhbWJkYSBydW50aW1lIVxuICAgICAgICBjb25zdCBydW50aW1lRGVwcyA9IHByb2plY3RQYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXMgfHwge307XG5cbiAgICAgICAgcGFja2FnZU5hbWVzLmZvckVhY2gocGtnID0+IHtcbiAgICAgICAgICAgIGlmIChydW50aW1lRGVwc1twa2ddKSB7XG4gICAgICAgICAgICAgICAgbGV0IGRlcFZhbHVlID0gcnVudGltZURlcHNbcGtnXTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBIYW5kbGUgbG9jYWwgZmlsZXN5c3RlbSBkZXBlbmRlbmNpZXMgKGUuZy4sIFwiLi4vZncyNC9cIiwgXCJmaWxlOi4uL2Z3MjRcIiwgb3IgXCIuLlxcZncyNFwiIG9uIFdpbmRvd3MpXG4gICAgICAgICAgICAgICAgY29uc3QgaXNMb2NhbERlcCA9IGRlcFZhbHVlLnN0YXJ0c1dpdGgoJ2ZpbGU6JykgfHwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXBWYWx1ZS5zdGFydHNXaXRoKCcuLi8nKSB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlcFZhbHVlLnN0YXJ0c1dpdGgoJy4vJykgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlcFZhbHVlLnN0YXJ0c1dpdGgoJy4uXFxcXCcpIHx8IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVwVmFsdWUuc3RhcnRzV2l0aCgnLlxcXFwnKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoaXNMb2NhbERlcCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBsb2NhbFBhdGggPSBkZXBWYWx1ZS5yZXBsYWNlKCdmaWxlOicsICcnKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gUmVzb2x2ZSBhYnNvbHV0ZSBwYXRoIG9mIHRoZSBsb2NhbCBwYWNrYWdlXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHBhdGhSZXNvbHZlKHByb2plY3RSb290LCBsb2NhbFBhdGgpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0c1N5bmMoYWJzb2x1dGVQYXRoKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2FsY3VsYXRlIHJlbGF0aXZlIHBhdGggZnJvbSBub2RlanNEaXIgdG8gdGhlIGxvY2FsIHBhY2thZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aEZyb21MYXllciA9IHBhdGhSZWxhdGl2ZShub2RlanNEaXIsIGFic29sdXRlUGF0aCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZXBWYWx1ZSA9IHJlbGF0aXZlUGF0aEZyb21MYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ1JJVElDQUw6IEhhc2ggdGhlIGNvbnRlbnRzIG9mIHRoZSBsb2NhbCBwYWNrYWdlIHRvIGRldGVjdCBjaGFuZ2VzXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBwYWNrYWdlIGhhcyBhIGRpc3QgZm9sZGVyIChidWlsdCBwYWNrYWdlcylcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpc3RQYXRoID0gcGF0aEpvaW4oYWJzb2x1dGVQYXRoLCAnZGlzdCcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0c1N5bmMoZGlzdFBhdGgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKGkiBIYXNoaW5nIGxvY2FsIHBhY2thZ2UgXCIke3BrZ31cIiBkaXN0IGZvbGRlciBmb3IgY2hhbmdlIGRldGVjdGlvbi4uLmApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRlbnRIYXNoID0gaGFzaERpcmVjdG9yeUNvbnRlbnRzKGRpc3RQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2NhbFBhY2thZ2VIYXNoZXNbcGtnXSA9IGNvbnRlbnRIYXNoO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgICAg4oaSIExvY2FsIHBhY2thZ2UgXCIke3BrZ31cIiBjb250ZW50IGhhc2g6ICR7Y29udGVudEhhc2guc3Vic3RyaW5nKDAsIDgpfS4uLmApO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgICAg4pqg77iPICBMb2NhbCBwYWNrYWdlIFwiJHtwa2d9XCIgaGFzIG5vIGRpc3QgZm9sZGVyLCBjaGFuZ2UgZGV0ZWN0aW9uIG1heSBtaXNzIHVwZGF0ZXNgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKGkiBSZXNvbHZlZCBsb2NhbCBwYWNrYWdlIFwiJHtwa2d9XCI6ICR7cmVsYXRpdmVQYXRoRnJvbUxheWVyfWApO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYOKaoO+4jyAgTG9jYWwgcGFja2FnZSBwYXRoIG5vdCBmb3VuZDogJHthYnNvbHV0ZVBhdGh9YCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcGFja2FnZUpzb24uZGVwZW5kZW5jaWVzW3BrZ10gPSBkZXBWYWx1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gUGFja2FnZSBub3QgZm91bmQgaW4gZGVwZW5kZW5jaWVzIC0gdGhpcyBpcyBhIGNvbmZpZ3VyYXRpb24gZXJyb3JcbiAgICAgICAgICAgICAgICBjb25zdCBlcnJvck1zZyA9IFtcbiAgICAgICAgICAgICAgICAgICAgYOKdjCBQYWNrYWdlIFwiJHtwa2d9XCIgbm90IGZvdW5kIGluIHJ1bnRpbWUgZGVwZW5kZW5jaWVzLmAsXG4gICAgICAgICAgICAgICAgICAgIGAgICBUaGlzIHBhY2thZ2UgaXMgbWFya2VkIGFzICdleHRlcm5hbCcgaW4gdGhlIGxheWVyIGJ1aWxkIGJ1dCBpcyBub3QgaW4gcGFja2FnZS5qc29uIGRlcGVuZGVuY2llcy5gLFxuICAgICAgICAgICAgICAgICAgICBgICAgQWRkIFwiJHtwa2d9XCIgdG8gZGVwZW5kZW5jaWVzIGluIHBhY2thZ2UuanNvbiB3aXRoIGEgc3BlY2lmaWMgdmVyc2lvbi5gLFxuICAgICAgICAgICAgICAgICAgICBgICAgRXhhbXBsZTogbnBtIGluc3RhbGwgJHtwa2d9IC0tc2F2ZWAsXG4gICAgICAgICAgICAgICAgICAgIGAgICBUaGVuIHJlYnVpbGQgdGhlIGxheWVyLmBcbiAgICAgICAgICAgICAgICBdLmpvaW4oJ1xcbicpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGxvZ2dlci5lcnJvcihlcnJvck1zZyk7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHJ1bnRpbWUgZGVwZW5kZW5jeTogJHtwa2d9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHBhY2thZ2VKc29uQ29udGVudCA9IEpTT04uc3RyaW5naWZ5KHBhY2thZ2VKc29uLCBudWxsLCAyKTtcbiAgICBjb25zdCBoYXNoID0gY3JlYXRlSGFzaCgnc2hhMjU2Jyk7XG4gICAgaGFzaC51cGRhdGUocGFja2FnZUpzb25Db250ZW50KTtcbiAgICBcbiAgICAvLyBDUklUSUNBTDogSW5jbHVkZSBsb2NhbCBwYWNrYWdlIGNvbnRlbnQgaGFzaGVzIGluIHRoZSBjYWNoZSBrZXlcbiAgICAvLyBUaGlzIGVuc3VyZXMgd2UgcmVpbnN0YWxsIHdoZW4gbG9jYWwgcGFja2FnZXMgY2hhbmdlIChlLmcuLCBmdzI0IHVwZGF0ZXMpXG4gICAgaWYgKE9iamVjdC5rZXlzKGxvY2FsUGFja2FnZUhhc2hlcykubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYCAgIOKGkiBJbmNsdWRpbmcgJHtPYmplY3Qua2V5cyhsb2NhbFBhY2thZ2VIYXNoZXMpLmxlbmd0aH0gbG9jYWwgcGFja2FnZSBjb250ZW50IGhhc2hlcyBpbiBjYWNoZSBrZXlgKTtcbiAgICAgICAgT2JqZWN0LmtleXMobG9jYWxQYWNrYWdlSGFzaGVzKS5zb3J0KCkuZm9yRWFjaChwa2cgPT4ge1xuICAgICAgICAgICAgaGFzaC51cGRhdGUoYCR7cGtnfToke2xvY2FsUGFja2FnZUhhc2hlc1twa2ddfWApO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgY29uc3QgY3VycmVudFBhY2thZ2VIYXNoID0gaGFzaC5kaWdlc3QoJ2hleCcpO1xuICAgIFxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIEZBU1QgUEFUSDogQ2hlY2sgaWYgd2UgY2FuIHNraXAgbnBtIGluc3RhbGxcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICBpZiAoZXhpc3RzU3luYyhwYWNrYWdlSGFzaFBhdGgpICYmIGV4aXN0c1N5bmMobm9kZU1vZHVsZXNEaXIpKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBwcmV2aW91c0hhc2ggPSByZWFkRmlsZVN5bmMocGFja2FnZUhhc2hQYXRoLCAndXRmLTgnKS50cmltKCk7XG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSBoYXNoIGZvcm1hdCAoU0hBLTI1NiA9IDY0IGhleCBjaGFycylcbiAgICAgICAgICAgIGlmIChwcmV2aW91c0hhc2gubGVuZ3RoID09PSA2NCAmJiAvXlswLTlhLWZdezY0fSQvLnRlc3QocHJldmlvdXNIYXNoKSkge1xuICAgICAgICAgICAgICAgIGlmIChwcmV2aW91c0hhc2ggPT09IGN1cnJlbnRQYWNrYWdlSGFzaCkge1xuICAgICAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgICAg4pyTIERlcGVuZGVuY2llcyBhbHJlYWR5IGluc3RhbGxlZCwgc2tpcHBpbmcgbnBtIGluc3RhbGxgKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuOyAvLyBTQVZFRCAxMSsgU0VDT05EUyFcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxvZ2dlci53YXJuKGAgICDimqDvuI8gIEludmFsaWQgaGFzaCBpbiAke3BhY2thZ2VIYXNoUGF0aH0sIHJlYnVpbGRpbmcgZm9yIHNhZmV0eWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgbG9nZ2VyLndhcm4oYCAgIOKaoO+4jyAgRmFpbGVkIHRvIHJlYWQgaGFzaCBmaWxlLCByZWJ1aWxkaW5nIGZvciBzYWZldHk6YCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIFNMT1cgUEFUSDogTmVlZCB0byBydW4gbnBtIGluc3RhbGxcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICBsb2dnZXIuaW5mbyhgICAgSW5zdGFsbGluZyAke3BhY2thZ2VOYW1lcy5sZW5ndGh9IHBhY2thZ2VzOiAke3BhY2thZ2VOYW1lcy5qb2luKCcsICcpfWApO1xuICAgIFxuICAgIGNvbnN0IGluc3RhbGxTdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgLy8gRW5zdXJlIGRpcmVjdG9yeSBleGlzdHNcbiAgICBpZiAoIWV4aXN0c1N5bmMobm9kZWpzRGlyKSkge1xuICAgICAgICBta2RpclN5bmMobm9kZWpzRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICB9XG5cbiAgICAvLyBXcml0ZSBwYWNrYWdlLmpzb25cbiAgICB3cml0ZUZpbGVTeW5jKHBhY2thZ2VKc29uUGF0aCwgcGFja2FnZUpzb25Db250ZW50KTtcblxuICAgIC8vIEluc3RhbGwgZGVwZW5kZW5jaWVzXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gLS1pbnN0YWxsLWxpbmtzIGlzIG5lZWRlZCB0byBpbnN0YWxsIGxvY2FsIHBhY2thZ2VzIGZyb20gZmlsZTogcmVmZXJlbmNlc1xuICAgICAgICAvLyAtLXByZWZlci1vZmZsaW5lIGlzIG5lZWRlZCB0byBzcGVlZCB1cCB0aGUgaW5zdGFsbGF0aW9uXG4gICAgICAgIC8vIC0tbm8tcGFja2FnZS1sb2NrIGlzIG5lZWRlZCB0byBhdm9pZCBwYWNrYWdlLWxvY2suanNvbiBjb25mbGljdHNcbiAgICAgICAgLy8gLS1vbWl0PWRldiBpcyBuZWVkZWQgdG8gYXZvaWQgaW5zdGFsbGluZyBkZXYgZGVwZW5kZW5jaWVzXG4gICAgICAgIGV4ZWNTeW5jKCducG0gaW5zdGFsbCAtLW9taXQ9ZGV2IC0tbm8tcGFja2FnZS1sb2NrIC0taW5zdGFsbC1saW5rcyAtLXByZWZlci1vZmZsaW5lJywge1xuICAgICAgICAgICAgY3dkOiBub2RlanNEaXIsXG4gICAgICAgICAgICBzdGRpbzogJ2luaGVyaXQnXG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgZWxhcHNlZCA9ICgoRGF0ZS5ub3coKSAtIGluc3RhbGxTdGFydFRpbWUpIC8gMTAwMCkudG9GaXhlZCgxKTtcbiAgICAgICAgbG9nZ2VyLmluZm8oYCAgIOKckyBucG0gaW5zdGFsbCBjb21wbGV0ZSBpbiAke2VsYXBzZWR9c2ApO1xuICAgICAgICBcbiAgICAgICAgLy8gU2F2ZSBoYXNoIGZvciBuZXh0IHJ1blxuICAgICAgICB3cml0ZUZpbGVTeW5jKHBhY2thZ2VIYXNoUGF0aCwgY3VycmVudFBhY2thZ2VIYXNoKTtcbiAgICAgICAgXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gaW5zdGFsbCBleHRlcm5hbCBkZXBlbmRlbmNpZXM6JywgZXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG59XG5cbi8qKlxuICogUmVjdXJzaXZlbHkgY29weSBhIGRpcmVjdG9yeVxuICovXG5mdW5jdGlvbiBjb3B5RGlyZWN0b3J5KHNvdXJjZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZykge1xuICAgIGlmICghZXhpc3RzU3luYyh0YXJnZXQpKSB7XG4gICAgICAgIG1rZGlyU3luYyh0YXJnZXQsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cbiAgICBjb25zdCBpdGVtcyA9IHJlYWRkaXJTeW5jKHNvdXJjZSk7XG4gICAgaXRlbXMuZm9yRWFjaChpdGVtID0+IHtcbiAgICAgICAgY29uc3Qgc291cmNlUGF0aCA9IHBhdGhKb2luKHNvdXJjZSwgaXRlbSk7XG4gICAgICAgIGNvbnN0IHRhcmdldFBhdGggPSBwYXRoSm9pbih0YXJnZXQsIGl0ZW0pO1xuICAgICAgICBpZiAobHN0YXRTeW5jKHNvdXJjZVBhdGgpLmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIGNvcHlEaXJlY3Rvcnkoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb3B5RmlsZVN5bmMoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCk7XG4gICAgICAgIH1cbiAgICB9KTtcbn1cbiJdfQ==