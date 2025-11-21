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
    logger = (0, logging_1.createLogger)(LayerConstruct);
    fw24 = fw24_1.Fw24.getInstance();
    name = LayerConstruct.name;
    dependencies = [];
    output;
    mainStack;
    /**
     * Creates a new LayerConstruct instance.
     * @param config - The configuration for the LayerConstruct.
     */
    constructor(config) {
        this.config = config;
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
        const distDirectory = layerConfig.distDirectory || (0, path_1.join)(__dirname, '../../dist');
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
     * Attempts to create a Lambda layer for a given TypeScript file.
     * @param file - The path to the TypeScript file.
     * @param distDirectory - The output directory for the build.
     * @param mainStack - The main stack for deploying resources.
     * @param layerConfig - The configuration for the layer.
     */
    async tryCreateLayerForFile(file, distDirectory, layerConfig) {
        const moduleExports = await Promise.resolve(`${file}`).then(s => __importStar(require(s)));
        const foundLayerDescriptorName = Object.keys(moduleExports).find((key) => {
            const exported = moduleExports[key];
            if (typeof exported === 'function' && isLayerEntry(exported)) {
                return exported;
            }
        });
        if (!foundLayerDescriptorName) {
            this.logger.warn(`No LayerEntry found in file ${file}. Will use Default options.`);
        }
        (0, decorators_1.LayerEntry)({ notGlobal: layerConfig.notGlobal ?? false });
        class EmptyLayerDescriptor {
        }
        // if no layer descriptor found in the file, create an empty class which will use default options
        const layerDescriptor = foundLayerDescriptorName ? moduleExports[foundLayerDescriptorName] : EmptyLayerDescriptor;
        const buildOptions = getLayerBuildOptions(layerDescriptor) || {};
        const fileBaseName = (0, path_1.basename)(file, (0, path_1.extname)(file));
        const layerName = getLayerName(layerDescriptor) || fileBaseName;
        const configuredOutputPath = `nodejs/node_modules/${layerConfig.packagePath ?? ''}`;
        const outputDir = (0, path_1.join)(distDirectory, layerName, configuredOutputPath, fileBaseName);
        const bundleDir = (0, path_1.join)(distDirectory, layerName);
        const tempDir = (0, path_1.join)(distDirectory, 'layers_temp', layerName);
        const tempOutputDir = (0, path_1.join)(tempDir, configuredOutputPath, fileBaseName);
        const tempOutputFile = (0, path_1.join)(tempOutputDir, 'index.js');
        // Ensure temp directory exists
        if (!(0, fs_1.existsSync)(tempOutputDir)) {
            (0, fs_1.mkdirSync)(tempOutputDir, { recursive: true });
        }
        // Build to temporary directory first
        await bundleWithEsbuild(file, tempOutputFile, buildOptions);
        // Install external dependencies if specified in buildOptions
        if (buildOptions.external && Array.isArray(buildOptions.external) && buildOptions.external.length > 0) {
            await installExternalDependencies(tempDir, buildOptions.external, this.logger);
        }
        // Move the entire nodejs directory (which contains both bundled code and npm packages)
        const tempNodejsDir = (0, path_1.join)(tempDir, 'nodejs');
        const outputNodejsDir = (0, path_1.join)(bundleDir, 'nodejs');
        // Check if output directory exists and compare contents
        const shouldUpdateOutput = !(0, fs_1.existsSync)(outputNodejsDir) || !areDirectoriesIdentical(tempNodejsDir, outputNodejsDir);
        if (shouldUpdateOutput) {
            this.logger.info(`Content changed for layer ${layerName}, updating output`);
            // Clean existing output if it exists
            if ((0, fs_1.existsSync)(outputNodejsDir)) {
                (0, fs_1.rmSync)(outputNodejsDir, { recursive: true });
            }
            // Ensure parent directory exists
            if (!(0, fs_1.existsSync)(bundleDir)) {
                (0, fs_1.mkdirSync)(bundleDir, { recursive: true });
            }
            // Move entire nodejs directory from temp to output
            (0, fs_1.renameSync)(tempNodejsDir, outputNodejsDir);
        }
        else {
            this.logger.warn(`No changes detected for layer ${layerName}, keeping existing code`);
        }
        // Clean up the temp directory for this layer
        if ((0, fs_1.existsSync)(tempDir)) {
            (0, fs_1.rmSync)(tempDir, { recursive: true });
            this.logger.info(`Cleaned up temp directory for layer ${layerName}`);
        }
        // this is the path that will be used in the layer import statement
        const layerImportPath = (0, path_1.join)('/opt', configuredOutputPath, fileBaseName, 'index.js');
        // put it into fw24's config so it can be added to the lambda's environment variables
        this.logger.info('layerImportPath', layerImportPath);
        this.fw24.setEnvironmentVariable(layerName, layerImportPath, 'layerImportPath');
        if (isGlobalLayer(layerDescriptor)) {
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
 * @param entryFile - The entry file to bundle.
 * @param outputFile - The output file path for the bundle.
 * @param buildOptions - The build options for esbuild.
 */
async function bundleWithEsbuild(entryFile, outputFile, buildOptions) {
    const defaultOptions = {
        bundle: true,
        platform: 'node',
        target: 'node18',
        minify: false,
        // keepNames: true, // Keep the names in the minified code for DI-tokens
        sourcemap: true,
        ...buildOptions, // Override with specific build options
        external: [...(buildOptions.external || []),
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
    logging_1.DefaultLogger.debug(`bundleWithEsbuild: Bundling ${entryFile} into ${outputFile} with options:`, defaultOptions);
    await (0, esbuild_1.build)(defaultOptions);
}
/**
 * Calculates hash of a file's contents
 */
function calculateFileHash(filePath) {
    const content = (0, fs_1.readFileSync)(filePath);
    return (0, crypto_1.createHash)('sha256').update(content).digest('hex');
}
/**
 * Compare two directories and check if their contents are identical
 */
function areDirectoriesIdentical(dir1, dir2) {
    if (!(0, fs_1.existsSync)(dir1) || !(0, fs_1.existsSync)(dir2))
        return false;
    try {
        const files1 = (0, fs_1.readdirSync)(dir1, { recursive: true });
        const files2 = (0, fs_1.readdirSync)(dir2, { recursive: true });
        if (files1.length !== files2.length)
            return false;
        return files1.every(file => {
            const file1Path = (0, path_1.join)(dir1, file);
            const file2Path = (0, path_1.join)(dir2, file);
            if (!(0, fs_1.existsSync)(file2Path))
                return false;
            const stat1 = (0, fs_1.lstatSync)(file1Path);
            const stat2 = (0, fs_1.lstatSync)(file2Path);
            if (stat1.isDirectory() !== stat2.isDirectory())
                return false;
            if (stat1.isDirectory())
                return true;
            return calculateFileHash(file1Path) === calculateFileHash(file2Path);
        });
    }
    catch (error) {
        return false;
    }
}
/**
 * Move directory contents from source to target
 */
function moveDirectoryContents(sourceDir, targetDir) {
    if (!(0, fs_1.existsSync)(targetDir)) {
        (0, fs_1.mkdirSync)(targetDir, { recursive: true });
    }
    const files = (0, fs_1.readdirSync)(sourceDir, { recursive: true });
    files.forEach(file => {
        const sourcePath = (0, path_1.join)(sourceDir, file);
        const targetPath = (0, path_1.join)(targetDir, file);
        if ((0, fs_1.lstatSync)(sourcePath).isDirectory()) {
            if (!(0, fs_1.existsSync)(targetPath)) {
                (0, fs_1.mkdirSync)(targetPath, { recursive: true });
            }
        }
        else {
            if ((0, fs_1.existsSync)(targetPath)) {
                (0, fs_1.rmSync)(targetPath);
            }
            (0, fs_1.renameSync)(sourcePath, targetPath);
        }
    });
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
 * Installs external dependencies into the layer's node_modules directory.
 * This is called when buildOptions.external contains packages that should not be bundled.
 *
 * @param layerTempDir - The temporary directory for the layer (e.g., dist/layers_temp/shared-layer)
 * @param externalPackages - Array of package names to install (e.g., ['axios', 'firebase-admin'])
 * @param logger - Logger instance for output
 */
async function installExternalDependencies(layerTempDir, externalPackages, logger) {
    // Filter out regex patterns and framework/built-in modules
    const packageNames = externalPackages.filter(pkg => typeof pkg === 'string' &&
        !pkg.startsWith('@aws-sdk') &&
        !pkg.startsWith('@smithy') &&
        !pkg.startsWith('aws-cdk-lib') &&
        pkg !== 'esbuild' &&
        pkg !== '@ten24group/fw24');
    if (packageNames.length === 0) {
        return;
    }
    logger.info(`Installing external dependencies: ${packageNames.join(', ')}`);
    const nodejsDir = (0, path_1.join)(layerTempDir, 'nodejs');
    const nodeModulesDir = (0, path_1.join)(nodejsDir, 'node_modules');
    // Backup bundled code if it exists (npm install will wipe node_modules)
    const bundledCodeBackup = (0, path_1.join)(layerTempDir, '_bundled_code_backup');
    if ((0, fs_1.existsSync)(nodeModulesDir)) {
        // Move entire node_modules to backup
        (0, fs_1.renameSync)(nodeModulesDir, bundledCodeBackup);
    }
    // Ensure directories exist for npm install
    if (!(0, fs_1.existsSync)(nodeModulesDir)) {
        (0, fs_1.mkdirSync)(nodeModulesDir, { recursive: true });
    }
    // Create a temporary package.json with only the external dependencies
    const tempPackageJson = {
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
            tempPackageJson.dependencies[pkg] = 'latest';
        });
    }
    else {
        const projectPackageJson = JSON.parse((0, fs_1.readFileSync)(projectPackageJsonPath, 'utf-8'));
        const allDeps = {
            ...(projectPackageJson.dependencies || {}),
            ...(projectPackageJson.devDependencies || {})
        };
        packageNames.forEach(pkg => {
            if (allDeps[pkg]) {
                tempPackageJson.dependencies[pkg] = allDeps[pkg];
            }
            else {
                logger.warn(`Package ${pkg} not found in project package.json, using latest`);
                tempPackageJson.dependencies[pkg] = 'latest';
            }
        });
    }
    // Write the temporary package.json
    const tempPackageJsonPath = (0, path_1.join)(nodejsDir, 'package.json');
    (0, fs_1.writeFileSync)(tempPackageJsonPath, JSON.stringify(tempPackageJson, null, 2));
    // Install dependencies
    try {
        logger.info(`Running npm install in ${nodejsDir}`);
        (0, child_process_1.execSync)('npm install --omit=dev --no-package-lock', {
            cwd: nodejsDir,
            stdio: 'inherit'
        });
        logger.info('External dependencies installed successfully');
    }
    catch (error) {
        logger.error('Failed to install external dependencies:', error);
        throw error;
    }
    // Remove the temporary package.json (but keep node_modules)
    if ((0, fs_1.existsSync)(tempPackageJsonPath)) {
        (0, fs_1.rmSync)(tempPackageJsonPath);
    }
    // Restore bundled code from backup
    if ((0, fs_1.existsSync)(bundledCodeBackup)) {
        logger.info('Restoring bundled code into node_modules');
        // Copy contents from backup into node_modules
        const backupContents = (0, fs_1.readdirSync)(bundledCodeBackup);
        backupContents.forEach(item => {
            const sourcePath = (0, path_1.join)(bundledCodeBackup, item);
            const targetPath = (0, path_1.join)(nodeModulesDir, item);
            // Only copy if target doesn't exist (don't overwrite npm-installed packages)
            if (!(0, fs_1.existsSync)(targetPath)) {
                if ((0, fs_1.lstatSync)(sourcePath).isDirectory()) {
                    // Copy directory recursively
                    copyDirectory(sourcePath, targetPath);
                }
                else {
                    (0, fs_1.copyFileSync)(sourcePath, targetPath);
                }
            }
        });
        // Clean up backup
        (0, fs_1.rmSync)(bundledCodeBackup, { recursive: true });
        logger.info('Bundled code restored successfully');
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGF5ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9sYXllci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUE4YUEsc0NBRUM7QUE5YUQsMkNBQXdDO0FBQ3hDLHVDQUFvQztBQUNwQyx1REFBeUY7QUFDekYsd0NBQXNFO0FBQ3RFLHVEQUFzRztBQUN0RywrQkFBa0g7QUFDbEgsMkJBQTRJO0FBQzVJLGlEQUF5QztBQUN6QyxxQ0FBOEM7QUFDOUMsOENBQTJDO0FBRTNDLG1DQUFvQztBQThIcEM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTJCRztBQUNILE1BQWEsY0FBYztJQWNIO0lBYlgsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxjQUFjLENBQUMsQ0FBQztJQUN0QyxJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBRyxjQUFjLENBQUMsSUFBSSxDQUFDO0lBQzNCLFlBQVksR0FBYSxFQUFFLENBQUM7SUFDNUIsTUFBTSxDQUF1QjtJQUU3QixTQUFTLENBQVM7SUFFbEI7OztPQUdHO0lBQ0gsWUFBb0IsTUFBK0I7UUFBL0IsV0FBTSxHQUFOLE1BQU0sQ0FBeUI7UUFFL0MsZUFBZTtRQUNmLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxXQUFXLEVBQUUsRUFBRTtZQUMzQixXQUFXLENBQUMsSUFBSSxHQUFHLFdBQVcsQ0FBQyxJQUFJLElBQUksbUJBQW1CLENBQUM7WUFDM0QsSUFBSSxXQUFXLENBQUMsSUFBSSxLQUFLLG1CQUFtQixFQUFFLENBQUM7Z0JBQzNDLFdBQVcsQ0FBQyxjQUFjLEdBQUcsV0FBVyxDQUFDLGNBQWMsSUFBSSxLQUFLLENBQUM7WUFDckUsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsZUFBTSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUUsT0FB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LFdBQVEsRUFBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDMUMsTUFBTSxVQUFVLEdBQUcsSUFBQSxXQUFRLEVBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzFDLElBQUksSUFBQSxjQUFTLEVBQUMsVUFBVSxDQUFDLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUN0QyxhQUFhLENBQUMsVUFBVSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQzFDLENBQUM7YUFBTSxDQUFDO1lBQ0osSUFBQSxpQkFBWSxFQUFDLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUN6QyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2ZuT3V0cHV0LCBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuXG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0LCBGVzI0Q29uc3RydWN0T3V0cHV0LCBPdXRwdXRUeXBlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBEZWZhdWx0TG9nZ2VyLCBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IEFyY2hpdGVjdHVyZSwgQ29kZSwgTGF5ZXJWZXJzaW9uLCBMYXllclZlcnNpb25Qcm9wcywgUnVudGltZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgYmFzZW5hbWUgYXMgcGF0aEJhc2VOYW1lLCByZXNvbHZlIGFzIHBhdGhSZXNvbHZlLCBqb2luIGFzIHBhdGhKb2luLCBleHRuYW1lIGFzIHBhdGhFeHRuYW1lIH0gZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBleGlzdHNTeW5jLCBta2RpclN5bmMsIHJlYWRkaXJTeW5jLCBzdGF0U3luYywgcm1TeW5jLCBsc3RhdFN5bmMsIGNvcHlGaWxlU3luYywgcmVuYW1lU3luYywgcmVhZEZpbGVTeW5jLCB3cml0ZUZpbGVTeW5jIH0gZnJvbSAnZnMnO1xuaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGJ1aWxkLCBCdWlsZE9wdGlvbnMgfSBmcm9tICdlc2J1aWxkJztcbmltcG9ydCB7IExheWVyRW50cnkgfSBmcm9tIFwiLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwiY3J5cHRvXCI7XG5cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB0aGUgUEFDS0FHRV9ESVJFQ1RPUlkgbW9kZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJUGFja2FnZURpcmVjdG9yeUNvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBuYW1lIG9mIHRoZSBsYXllci5cbiAgICAgKi9cbiAgICBsYXllck5hbWU6IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBzb3VyY2UgcGF0aCBvZiB0aGUgbGF5ZXIgZGlyZWN0b3J5LlxuICAgICAqL1xuICAgIHNvdXJjZVBhdGg6IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBtb2RlIG9mIHBhY2thZ2luZzogcGFja2FnZSB0aGUgd2hvbGUgZGlyZWN0b3J5LlxuICAgICAqL1xuICAgIG1vZGU/OiAnUEFDS0FHRV9ESVJFQ1RPUlknO1xuXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgcHJvcGVydGllcyBmb3IgdGhlIGxheWVyIHZlcnNpb24uXG4gICAgICovXG4gICAgbGF5ZXJQcm9wcz86IE9taXQ8TGF5ZXJWZXJzaW9uUHJvcHMsICdjb2RlJz47XG5cbiAgICAvKipcbiAgICAgKiBQcmlvcml0eSBmb3IgbGF5ZXIgbG9hZGluZyBvcmRlci4gTG93ZXIgbnVtYmVycyBsb2FkIGZpcnN0LlxuICAgICAqIElmIG5vdCBzcGVjaWZpZWQsIHByaW9yaXR5IGlzIGF1dG8tYXNzaWduZWQgYXMgKGFycmF5X2luZGV4ICsgMTApLlxuICAgICAqIFxuICAgICAqIFByaW9yaXR5IHJhbmdlczpcbiAgICAgKiAtIDAtOTogUmVzZXJ2ZWQgZm9yIGZyYW1ld29yayBsYXllcnMgKGZ3MjQgY29yZSA9IDApXG4gICAgICogLSAxMCs6IFVzZXIvYXBwbGljYXRpb24gbGF5ZXJzIChhdXRvLWFzc2lnbmVkIG9yIGV4cGxpY2l0KVxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogLy8gQXV0by1hc3NpZ25lZCBwcmlvcml0aWVzIChyZWNvbW1lbmRlZCk6XG4gICAgICogY29uc3QgbGF5ZXJzID0gbmV3IERJTGF5ZXJDb25zdHJ1Y3QoW1xuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9kaS50cycgfSwgICAgICAgIC8vIHByaW9yaXR5OiAxMFxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9zaGFyZWQudHMnIH0sICAgIC8vIHByaW9yaXR5OiAxMVxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9maXJlYmFzZS50cycgfSAgIC8vIHByaW9yaXR5OiAxMlxuICAgICAqIF0pO1xuICAgICAqIFxuICAgICAqIC8vIEV4cGxpY2l0IHByaW9yaXRpZXMgKGZvciBzcGVjaWFsIGNhc2VzKTpcbiAgICAgKiBjb25zdCBsYXllcnMgPSBuZXcgRElMYXllckNvbnN0cnVjdChbXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2RpLnRzJywgcHJpb3JpdHk6IDEwIH0sICAgICAgLy8gTG9hZCBmaXJzdFxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9maXJlYmFzZS50cycsIHByaW9yaXR5OiAyMCB9LCAvLyBMb2FkIGxhc3RcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vc2hhcmVkLnRzJywgcHJpb3JpdHk6IDE1IH0gICAvLyBMb2FkIGluIGJldHdlZW5cbiAgICAgKiBdKTtcbiAgICAgKi9cbiAgICBwcmlvcml0eT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB0aGUgQlVJTERfQU5EX1BBQ0tBR0UgbW9kZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIHNvdXJjZSBwYXRoIG9mIHRoZSBsYXllciwgd2hpY2ggY2FuIGJlIGEgZGlyZWN0b3J5IG9yIGEgZmlsZS5cbiAgICAgKi9cbiAgICBzb3VyY2VQYXRoOiBzdHJpbmc7XG4gICAgXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgcHJvcGVydGllcyBmb3IgdGhlIGxheWVyIHZlcnNpb24uXG4gICAgICovXG4gICAgbGF5ZXJQcm9wcz86IE9taXQ8TGF5ZXJWZXJzaW9uUHJvcHMsICdjb2RlJz47XG5cbiAgICAvKipcbiAgICAgKiBUaGUgbW9kZSBvZiBwYWNrYWdpbmc6IHNjYW4gYW5kIGJ1aWxkIGluZGl2aWR1YWwgZmlsZXMuXG4gICAgICovXG4gICAgbW9kZTogJ0JVSUxEX0FORF9QQUNLQUdFJztcblxuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIGN1c3RvbSBkaXN0cmlidXRpb24gZGlyZWN0b3J5IGZvciB0aGUgYnVpbGQgb3V0cHV0cy5cbiAgICAgKi9cbiAgICBkaXN0RGlyZWN0b3J5Pzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogRmxhZyB0byBjbGVhciB0aGUgb3V0cHV0IGRpcmVjdG9yeSBhZnRlciBwYWNrYWdpbmc7IGRlZmF1bHRzIHRvIGZhbHNlLlxuICAgICAqL1xuICAgIGNsZWFyT3V0cHV0RGlyPzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyYWJsZSBvdXRwdXQgcGF0aCBmb3IgdGhlIHBhY2thZ2UuXG4gICAgICovIFxuICAgIHBhY2thZ2VQYXRoPzogc3RyaW5nO1xuXG4gICAgXG4gICAgbm90R2xvYmFsPzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIFByaW9yaXR5IGZvciBsYXllciBsb2FkaW5nIG9yZGVyLiBMb3dlciBudW1iZXJzIGxvYWQgZmlyc3QuXG4gICAgICogSWYgbm90IHNwZWNpZmllZCwgcHJpb3JpdHkgaXMgYXV0by1hc3NpZ25lZCBhcyAoYXJyYXlfaW5kZXggKyAxMCkuXG4gICAgICogXG4gICAgICogUHJpb3JpdHkgcmFuZ2VzOlxuICAgICAqIC0gMC05OiBSZXNlcnZlZCBmb3IgZnJhbWV3b3JrIGxheWVycyAoZncyNCBjb3JlID0gMClcbiAgICAgKiAtIDEwKzogVXNlci9hcHBsaWNhdGlvbiBsYXllcnMgKGF1dG8tYXNzaWduZWQgb3IgZXhwbGljaXQpXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiAvLyBBdXRvLWFzc2lnbmVkIHByaW9yaXRpZXMgKHJlY29tbWVuZGVkKTpcbiAgICAgKiBjb25zdCBsYXllcnMgPSBuZXcgRElMYXllckNvbnN0cnVjdChbXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2RpLnRzJyB9LCAgICAgICAgLy8gcHJpb3JpdHk6IDEwXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL3NoYXJlZC50cycgfSwgICAgLy8gcHJpb3JpdHk6IDExXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2ZpcmViYXNlLnRzJyB9ICAgLy8gcHJpb3JpdHk6IDEyXG4gICAgICogXSk7XG4gICAgICogXG4gICAgICogLy8gRXhwbGljaXQgcHJpb3JpdGllcyAoZm9yIHNwZWNpYWwgY2FzZXMpOlxuICAgICAqIGNvbnN0IGxheWVycyA9IG5ldyBESUxheWVyQ29uc3RydWN0KFtcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vZGkudHMnLCBwcmlvcml0eTogMTAgfSwgICAgICAvLyBMb2FkIGZpcnN0XG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2ZpcmViYXNlLnRzJywgcHJpb3JpdHk6IDIwIH0sIC8vIExvYWQgbGFzdFxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9zaGFyZWQudHMnLCBwcmlvcml0eTogMTUgfSAgIC8vIExvYWQgaW4gYmV0d2VlblxuICAgICAqIF0pO1xuICAgICAqL1xuICAgIHByaW9yaXR5PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIGxheWVyIGNvbnN0cnVjdC5cbiAqIFxuICogTGF5ZXJzIGFyZSBwcm9jZXNzZWQgaW4gcGFyYWxsZWwgZm9yIHNwZWVkLCBidXQgbG9hZGVkIGF0IHJ1bnRpbWUgaW4gcHJpb3JpdHkgb3JkZXIuXG4gKiBQcmlvcml0eSBkZXRlcm1pbmVzIHRoZSBvcmRlciBpbiB3aGljaCBsYXllcnMgaW5pdGlhbGl6ZSB3aGVuIExhbWJkYSBjb2xkIHN0YXJ0cy5cbiAqIFxuICogQHNlZSBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnLnByaW9yaXR5IGZvciBwcmlvcml0eSBkZXRhaWxzXG4gKi9cbmV4cG9ydCB0eXBlIElMYXllckNvbnN0cnVjdENvbmZpZyA9IElQYWNrYWdlRGlyZWN0b3J5Q29uZmlnIHwgSUJ1aWxkQW5kUGFja2FnZUNvbmZpZztcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgY29uc3RydWN0IGZvciBjcmVhdGluZyBMYW1iZGEgbGF5ZXJzLlxuICogXG4gKiBMYXllcnMgYXJlIGJ1aWx0IGluIHBhcmFsbGVsIGZvciBwZXJmb3JtYW5jZSwgYnV0IGluaXRpYWxpemUgYXQgTGFtYmRhIHJ1bnRpbWVcbiAqIGluIHByaW9yaXR5IG9yZGVyLiBUaGlzIGVuc3VyZXMgY29ycmVjdCBkZXBlbmRlbmN5IGxvYWRpbmcgKGUuZy4sIERJIGNvbnRhaW5lclxuICogbG9hZHMgYmVmb3JlIGxheWVycyB0aGF0IHVzZSBpdCkuXG4gKiBcbiAqIFByaW9yaXR5IFN5c3RlbTpcbiAqIC0gMC05OiBSZXNlcnZlZCBmb3IgZnJhbWV3b3JrIGxheWVycyAoZncyNCBjb3JlID0gMClcbiAqIC0gMTArOiBBcHBsaWNhdGlvbiBsYXllcnMgKGF1dG8tYXNzaWduZWQgc3RhcnRpbmcgYXQgMTAsIG9yIHNldCBleHBsaWNpdGx5KVxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIEJhc2ljIHVzYWdlIHdpdGggYXV0by1wcmlvcml0eSAocmVjb21tZW5kZWQpXG4gKiBjb25zdCBkaUxheWVyID0gbmV3IERJTGF5ZXJDb25zdHJ1Y3QoW1xuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9kaS50cycgfSwgICAgICAgICAgICAgIC8vIHByaW9yaXR5OiAxMCAoYXV0bylcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvY29uZmlnL3NoYXJlZC50cycgfSwgICAvLyBwcmlvcml0eTogMTEgKGF1dG8pXG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2NvbmZpZy9maXJlYmFzZS50cycgfSAgLy8gcHJpb3JpdHk6IDEyIChhdXRvKVxuICogXSk7XG4gKiBcbiAqIC8vIEFkdmFuY2VkIHVzYWdlIHdpdGggZXhwbGljaXQgcHJpb3JpdGllc1xuICogY29uc3QgZGlMYXllciA9IG5ldyBESUxheWVyQ29uc3RydWN0KFtcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvZGkudHMnLCBwcmlvcml0eTogMTAgfSwgICAgICAgIC8vIExvYWQgZmlyc3RcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvY29uZmlnL2ZpcmViYXNlLnRzJywgcHJpb3JpdHk6IDIwIH0sIC8vIExvYWQgbGFzdFxuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9jb25maWcvc2hhcmVkLnRzJywgcHJpb3JpdHk6IDE1IH0gICAgLy8gTG9hZCBpbiBiZXR3ZWVuXG4gKiBdKTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgTGF5ZXJDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoTGF5ZXJDb25zdHJ1Y3QpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgXG4gICAgbmFtZSA9IExheWVyQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgTGF5ZXJDb25zdHJ1Y3QgaW5zdGFuY2UuXG4gICAgICogQHBhcmFtIGNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgTGF5ZXJDb25zdHJ1Y3QuXG4gICAgICovXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSBjb25maWc6IElMYXllckNvbnN0cnVjdENvbmZpZ1tdKSB7XG4gICAgICAgIFxuICAgICAgICAvLyBhZGQgZGVmYXVsdHNcbiAgICAgICAgY29uZmlnLmZvckVhY2goKGxheWVyQ29uZmlnKSA9PiB7XG4gICAgICAgICAgICBsYXllckNvbmZpZy5tb2RlID0gbGF5ZXJDb25maWcubW9kZSB8fCAnUEFDS0FHRV9ESVJFQ1RPUlknO1xuICAgICAgICAgICAgaWYgKGxheWVyQ29uZmlnLm1vZGUgPT09ICdCVUlMRF9BTkRfUEFDS0FHRScpIHtcbiAgICAgICAgICAgICAgICBsYXllckNvbmZpZy5jbGVhck91dHB1dERpciA9IGxheWVyQ29uZmlnLmNsZWFyT3V0cHV0RGlyID8/IGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhjb25maWcsICdMQVlFUicpO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgLy8gQXNzaWduIHByaW9yaXR5IHRvIGVhY2ggbGF5ZXI6IHVzZSBleHBsaWNpdCBwcmlvcml0eSBpZiBzZXQsIG90aGVyd2lzZSB1c2UgYXJyYXkgaW5kZXggKyAxMFxuICAgICAgICAvLyBQcmlvcml0eSAwLTkgcmVzZXJ2ZWQgZm9yIGZyYW1ld29yayBsYXllcnMgKGZ3MjQgY29yZSA9IDApXG4gICAgICAgIC8vIFVzZXIgbGF5ZXJzIHN0YXJ0IGF0IDEwKyB0byBlbnN1cmUgZnJhbWV3b3JrIGxheWVycyBhbHdheXMgbG9hZCBmaXJzdFxuICAgICAgICB0aGlzLmNvbmZpZy5mb3JFYWNoKChsYXllckNvbmZpZywgaW5kZXgpID0+IHtcbiAgICAgICAgICAgIGlmICghbGF5ZXJDb25maWcucHJpb3JpdHkgJiYgbGF5ZXJDb25maWcucHJpb3JpdHkgIT09IDApIHtcbiAgICAgICAgICAgICAgICBsYXllckNvbmZpZy5wcmlvcml0eSA9IGluZGV4ICsgMTA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgbGF5ZXJzIGluIHBhcmFsbGVsIGZvciBzcGVlZCB3aGlsZSByZXNwZWN0aW5nIHByaW9yaXR5LWJhc2VkIGxvYWRpbmcgb3JkZXJcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwodGhpcy5jb25maWcubWFwKGFzeW5jIChsYXllckNvbmZpZykgPT4ge1xuICAgICAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sobGF5ZXJDb25maWcuc3RhY2tOYW1lIHx8IHRoaXMuZncyNC5nZXRDb25maWcoKS5sYXllclN0YWNrTmFtZSwgbGF5ZXJDb25maWcucGFyZW50U3RhY2tOYW1lKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJQcm9jZXNzaW5nIGxheWVyOlwiLCBsYXllckNvbmZpZyk7XG5cbiAgICAgICAgICAgIGlmIChsYXllckNvbmZpZy5tb2RlID09PSAnUEFDS0FHRV9ESVJFQ1RPUlknKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wYWNrYWdlRGlyZWN0b3J5KGxheWVyQ29uZmlnKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAobGF5ZXJDb25maWcubW9kZSA9PT0gJ0JVSUxEX0FORF9QQUNLQUdFJykge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuc2NhbkFuZFBhY2thZ2VGaWxlcyhsYXllckNvbmZpZyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBtb2RlIGZvciBsYXllciAke2xheWVyQ29uZmlnfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGFja2FnZXMgYSBkaXJlY3RvcnkgYXMgYSBMYW1iZGEgbGF5ZXIuXG4gICAgICogQHBhcmFtIGxheWVyQ29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBsYXllci5cbiAgICAgKiBAcGFyYW0gbWFpblN0YWNrIC0gVGhlIG1haW4gc3RhY2sgZm9yIGRlcGxveWluZyByZXNvdXJjZXMuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBwYWNrYWdlRGlyZWN0b3J5KGxheWVyQ29uZmlnOiBJUGFja2FnZURpcmVjdG9yeUNvbmZpZykge1xuICAgICAgICBjb25zdCBkZWZhdWx0TGF5ZXJQcm9wczogTGF5ZXJWZXJzaW9uUHJvcHMgPSB7XG4gICAgICAgICAgICBsYXllclZlcnNpb25OYW1lOiBsYXllckNvbmZpZy5sYXllck5hbWUsXG4gICAgICAgICAgICBjb21wYXRpYmxlUnVudGltZXM6IFsgUnVudGltZS5OT0RFSlNfMjJfWCBdLFxuICAgICAgICAgICAgY29kZTogQ29kZS5mcm9tQXNzZXQobGF5ZXJDb25maWcuc291cmNlUGF0aCksXG4gICAgICAgICAgICBjb21wYXRpYmxlQXJjaGl0ZWN0dXJlczogW0FyY2hpdGVjdHVyZS5BUk1fNjRdLFxuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgY29uc3QgbGF5ZXIgPSBuZXcgTGF5ZXJWZXJzaW9uKHRoaXMubWFpblN0YWNrLCBsYXllckNvbmZpZy5sYXllck5hbWUgKyAnLWxheWVyJywge1xuICAgICAgICAgICAgLi4uZGVmYXVsdExheWVyUHJvcHMsXG4gICAgICAgICAgICAuLi5sYXllckNvbmZpZy5sYXllclByb3BzLFxuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgbGF5ZXJDb25maWcubGF5ZXJOYW1lLCBsYXllciwgT3V0cHV0VHlwZS5MQVlFUiwgJ2xheWVyVmVyc2lvbkFybicpO1xuXG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBTY2FucyBhIGRpcmVjdG9yeSBmb3IgVHlwZVNjcmlwdCBmaWxlcyBhbmQgY3JlYXRlcyBMYW1iZGEgbGF5ZXJzIGZvciB0aGVtLlxuICAgICAqIEBwYXJhbSBsYXllckNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgbGF5ZXIuXG4gICAgICogQHBhcmFtIG1haW5TdGFjayAtIFRoZSBtYWluIHN0YWNrIGZvciBkZXBsb3lpbmcgcmVzb3VyY2VzLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgc2NhbkFuZFBhY2thZ2VGaWxlcyhsYXllckNvbmZpZzogSUJ1aWxkQW5kUGFja2FnZUNvbmZpZykge1xuICAgICAgICBjb25zdCBkaXN0RGlyZWN0b3J5ID0gbGF5ZXJDb25maWcuZGlzdERpcmVjdG9yeSB8fCBwYXRoSm9pbihfX2Rpcm5hbWUsICcuLi8uLi9kaXN0Jyk7XG4gICAgICAgIGNvbnN0IHNvdXJjZURpcmVjdG9yeU9yRmlsZU5hbWUgPSBwYXRoUmVzb2x2ZShsYXllckNvbmZpZy5zb3VyY2VQYXRoKTtcbiAgICAgICAgY29uc3QgdHNGaWxlcyA9IGxzdGF0U3luYyhzb3VyY2VEaXJlY3RvcnlPckZpbGVOYW1lKS5pc0RpcmVjdG9yeSgpXG4gICAgICAgICAgICA/IHNjYW5EaXJlY3Rvcnkoc291cmNlRGlyZWN0b3J5T3JGaWxlTmFtZSlcbiAgICAgICAgICAgIDogW3NvdXJjZURpcmVjdG9yeU9yRmlsZU5hbWVdO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgZmlsZXMgaW4gcGFyYWxsZWwgbm93IHRoYXQgd2UgaGF2ZSBwcmlvcml0eS1iYXNlZCBvcmRlcmluZ1xuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbCh0c0ZpbGVzLm1hcChhc3luYyAoZmlsZSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy50cnlDcmVhdGVMYXllckZvckZpbGUoZmlsZSwgZGlzdERpcmVjdG9yeSwgbGF5ZXJDb25maWcpO1xuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQXR0ZW1wdHMgdG8gY3JlYXRlIGEgTGFtYmRhIGxheWVyIGZvciBhIGdpdmVuIFR5cGVTY3JpcHQgZmlsZS5cbiAgICAgKiBAcGFyYW0gZmlsZSAtIFRoZSBwYXRoIHRvIHRoZSBUeXBlU2NyaXB0IGZpbGUuXG4gICAgICogQHBhcmFtIGRpc3REaXJlY3RvcnkgLSBUaGUgb3V0cHV0IGRpcmVjdG9yeSBmb3IgdGhlIGJ1aWxkLlxuICAgICAqIEBwYXJhbSBtYWluU3RhY2sgLSBUaGUgbWFpbiBzdGFjayBmb3IgZGVwbG95aW5nIHJlc291cmNlcy5cbiAgICAgKiBAcGFyYW0gbGF5ZXJDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIGxheWVyLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgdHJ5Q3JlYXRlTGF5ZXJGb3JGaWxlKGZpbGU6IHN0cmluZywgZGlzdERpcmVjdG9yeTogc3RyaW5nLCBsYXllckNvbmZpZzogSUJ1aWxkQW5kUGFja2FnZUNvbmZpZykge1xuICAgICAgICBcbiAgICAgICAgY29uc3QgbW9kdWxlRXhwb3J0cyA9IGF3YWl0IGltcG9ydChmaWxlKTtcblxuICAgICAgICBjb25zdCBmb3VuZExheWVyRGVzY3JpcHRvck5hbWUgPSBPYmplY3Qua2V5cyhtb2R1bGVFeHBvcnRzKS5maW5kKChrZXkpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGV4cG9ydGVkID0gbW9kdWxlRXhwb3J0c1trZXldO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRlZCA9PT0gJ2Z1bmN0aW9uJyAmJiBpc0xheWVyRW50cnkoZXhwb3J0ZWQpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4cG9ydGVkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgXG4gICAgICAgIGlmKCFmb3VuZExheWVyRGVzY3JpcHRvck5hbWUpe1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gTGF5ZXJFbnRyeSBmb3VuZCBpbiBmaWxlICR7ZmlsZX0uIFdpbGwgdXNlIERlZmF1bHQgb3B0aW9ucy5gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIExheWVyRW50cnkoeyBub3RHbG9iYWw6IGxheWVyQ29uZmlnLm5vdEdsb2JhbCA/PyBmYWxzZSB9KVxuICAgICAgICBjbGFzcyBFbXB0eUxheWVyRGVzY3JpcHRvciB7fVxuXG4gICAgICAgIC8vIGlmIG5vIGxheWVyIGRlc2NyaXB0b3IgZm91bmQgaW4gdGhlIGZpbGUsIGNyZWF0ZSBhbiBlbXB0eSBjbGFzcyB3aGljaCB3aWxsIHVzZSBkZWZhdWx0IG9wdGlvbnNcbiAgICAgICAgY29uc3QgbGF5ZXJEZXNjcmlwdG9yID0gZm91bmRMYXllckRlc2NyaXB0b3JOYW1lID8gbW9kdWxlRXhwb3J0c1tmb3VuZExheWVyRGVzY3JpcHRvck5hbWVdIDogRW1wdHlMYXllckRlc2NyaXB0b3I7XG5cbiAgICAgICAgY29uc3QgYnVpbGRPcHRpb25zID0gZ2V0TGF5ZXJCdWlsZE9wdGlvbnMobGF5ZXJEZXNjcmlwdG9yKSB8fCB7fTtcblxuICAgICAgICBjb25zdCBmaWxlQmFzZU5hbWUgPSBwYXRoQmFzZU5hbWUoZmlsZSwgcGF0aEV4dG5hbWUoZmlsZSkpO1xuICAgICAgICBjb25zdCBsYXllck5hbWUgPSBnZXRMYXllck5hbWUobGF5ZXJEZXNjcmlwdG9yKSB8fCBmaWxlQmFzZU5hbWU7XG4gICAgICAgIGNvbnN0IGNvbmZpZ3VyZWRPdXRwdXRQYXRoID0gYG5vZGVqcy9ub2RlX21vZHVsZXMvJHtsYXllckNvbmZpZy5wYWNrYWdlUGF0aCA/PyAnJ31gIDtcbiAgICBcbiAgICAgICAgY29uc3Qgb3V0cHV0RGlyID0gcGF0aEpvaW4oZGlzdERpcmVjdG9yeSwgbGF5ZXJOYW1lLCBjb25maWd1cmVkT3V0cHV0UGF0aCwgZmlsZUJhc2VOYW1lKTtcbiAgICAgICAgY29uc3QgYnVuZGxlRGlyID0gcGF0aEpvaW4oZGlzdERpcmVjdG9yeSwgbGF5ZXJOYW1lKTtcblxuICAgICAgICBjb25zdCB0ZW1wRGlyID0gcGF0aEpvaW4oZGlzdERpcmVjdG9yeSwgJ2xheWVyc190ZW1wJywgbGF5ZXJOYW1lKTtcbiAgICAgICAgY29uc3QgdGVtcE91dHB1dERpciA9IHBhdGhKb2luKHRlbXBEaXIsIGNvbmZpZ3VyZWRPdXRwdXRQYXRoLCBmaWxlQmFzZU5hbWUpO1xuICAgICAgICBjb25zdCB0ZW1wT3V0cHV0RmlsZSA9IHBhdGhKb2luKHRlbXBPdXRwdXREaXIsICdpbmRleC5qcycpO1xuXG4gICAgICAgIC8vIEVuc3VyZSB0ZW1wIGRpcmVjdG9yeSBleGlzdHNcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKHRlbXBPdXRwdXREaXIpKSB7XG4gICAgICAgICAgICBta2RpclN5bmModGVtcE91dHB1dERpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBCdWlsZCB0byB0ZW1wb3JhcnkgZGlyZWN0b3J5IGZpcnN0XG4gICAgICAgIGF3YWl0IGJ1bmRsZVdpdGhFc2J1aWxkKGZpbGUsIHRlbXBPdXRwdXRGaWxlLCBidWlsZE9wdGlvbnMpO1xuXG4gICAgICAgIC8vIEluc3RhbGwgZXh0ZXJuYWwgZGVwZW5kZW5jaWVzIGlmIHNwZWNpZmllZCBpbiBidWlsZE9wdGlvbnNcbiAgICAgICAgaWYgKGJ1aWxkT3B0aW9ucy5leHRlcm5hbCAmJiBBcnJheS5pc0FycmF5KGJ1aWxkT3B0aW9ucy5leHRlcm5hbCkgJiYgYnVpbGRPcHRpb25zLmV4dGVybmFsLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGF3YWl0IGluc3RhbGxFeHRlcm5hbERlcGVuZGVuY2llcyh0ZW1wRGlyLCBidWlsZE9wdGlvbnMuZXh0ZXJuYWwsIHRoaXMubG9nZ2VyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE1vdmUgdGhlIGVudGlyZSBub2RlanMgZGlyZWN0b3J5ICh3aGljaCBjb250YWlucyBib3RoIGJ1bmRsZWQgY29kZSBhbmQgbnBtIHBhY2thZ2VzKVxuICAgICAgICBjb25zdCB0ZW1wTm9kZWpzRGlyID0gcGF0aEpvaW4odGVtcERpciwgJ25vZGVqcycpO1xuICAgICAgICBjb25zdCBvdXRwdXROb2RlanNEaXIgPSBwYXRoSm9pbihidW5kbGVEaXIsICdub2RlanMnKTtcbiAgICAgICAgXG4gICAgICAgIC8vIENoZWNrIGlmIG91dHB1dCBkaXJlY3RvcnkgZXhpc3RzIGFuZCBjb21wYXJlIGNvbnRlbnRzXG4gICAgICAgIGNvbnN0IHNob3VsZFVwZGF0ZU91dHB1dCA9ICFleGlzdHNTeW5jKG91dHB1dE5vZGVqc0RpcikgfHwgIWFyZURpcmVjdG9yaWVzSWRlbnRpY2FsKHRlbXBOb2RlanNEaXIsIG91dHB1dE5vZGVqc0Rpcik7XG5cbiAgICAgICAgaWYgKHNob3VsZFVwZGF0ZU91dHB1dCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29udGVudCBjaGFuZ2VkIGZvciBsYXllciAke2xheWVyTmFtZX0sIHVwZGF0aW5nIG91dHB1dGApO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDbGVhbiBleGlzdGluZyBvdXRwdXQgaWYgaXQgZXhpc3RzXG4gICAgICAgICAgICBpZiAoZXhpc3RzU3luYyhvdXRwdXROb2RlanNEaXIpKSB7XG4gICAgICAgICAgICAgICAgcm1TeW5jKG91dHB1dE5vZGVqc0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEVuc3VyZSBwYXJlbnQgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGJ1bmRsZURpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMoYnVuZGxlRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gTW92ZSBlbnRpcmUgbm9kZWpzIGRpcmVjdG9yeSBmcm9tIHRlbXAgdG8gb3V0cHV0XG4gICAgICAgICAgICByZW5hbWVTeW5jKHRlbXBOb2RlanNEaXIsIG91dHB1dE5vZGVqc0Rpcik7XG5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIGNoYW5nZXMgZGV0ZWN0ZWQgZm9yIGxheWVyICR7bGF5ZXJOYW1lfSwga2VlcGluZyBleGlzdGluZyBjb2RlYCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDbGVhbiB1cCB0aGUgdGVtcCBkaXJlY3RvcnkgZm9yIHRoaXMgbGF5ZXJcbiAgICAgICAgaWYgKGV4aXN0c1N5bmModGVtcERpcikpIHtcbiAgICAgICAgICAgIHJtU3luYyh0ZW1wRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENsZWFuZWQgdXAgdGVtcCBkaXJlY3RvcnkgZm9yIGxheWVyICR7bGF5ZXJOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gdGhpcyBpcyB0aGUgcGF0aCB0aGF0IHdpbGwgYmUgdXNlZCBpbiB0aGUgbGF5ZXIgaW1wb3J0IHN0YXRlbWVudFxuICAgICAgICBjb25zdCBsYXllckltcG9ydFBhdGggPSBwYXRoSm9pbignL29wdCcsIGNvbmZpZ3VyZWRPdXRwdXRQYXRoLCBmaWxlQmFzZU5hbWUsICdpbmRleC5qcycpO1xuICAgICAgICAvLyBwdXQgaXQgaW50byBmdzI0J3MgY29uZmlnIHNvIGl0IGNhbiBiZSBhZGRlZCB0byB0aGUgbGFtYmRhJ3MgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ2xheWVySW1wb3J0UGF0aCcsIGxheWVySW1wb3J0UGF0aCk7XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUobGF5ZXJOYW1lLCBsYXllckltcG9ydFBhdGgsICdsYXllckltcG9ydFBhdGgnKTtcblxuICAgICAgICBpZihpc0dsb2JhbExheWVyKGxheWVyRGVzY3JpcHRvcikpe1xuICAgICAgICAgICAgLy8gY29sbGVjdCBnbG9iYWwgbGF5ZXJzIGZvciBsYW1iZGFcbiAgICAgICAgICAgIHRoaXMuZncyNC5hZGRHbG9iYWxMYW1iZGFMYXllck5hbWVzKGxheWVyTmFtZSk7XG4gICAgICAgICAgICAvLyBjb2xsZWN0IGdsb2JhbCBlbnRyeS1wYWNrYWdlcyBmb3IgbGFtYmRhcyB3aXRoIHByaW9yaXR5IGZvciBjb3JyZWN0IGxvYWRpbmcgb3JkZXJcbiAgICAgICAgICAgIC8vIFByaW9yaXR5IGlzIGFsd2F5cyBzZXQgaW4gY29uc3RydWN0KCksIHNvIGl0IG11c3QgYmUgZGVmaW5lZCBoZXJlXG4gICAgICAgICAgICBpZiAobGF5ZXJDb25maWcucHJpb3JpdHkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTGF5ZXIgJHtsYXllck5hbWV9IGhhcyBubyBwcmlvcml0eS4gVGhpcyBzaG91bGQgbmV2ZXIgaGFwcGVuLmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5mdzI0LmFkZEdsb2JhbExhbWJkYUVudHJ5UGFja2FnZShgZW52OmxheWVySW1wb3J0UGF0aDoke2xheWVyTmFtZX1gLCBsYXllckNvbmZpZy5wcmlvcml0eSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYXllclByb3BzID0gZ2V0TGF5ZXJQcm9wcyhsYXllckRlc2NyaXB0b3IpO1xuXG4gICAgICAgIGNvbnN0IGRlZmF1bHRMYXllclByb3BzOiBMYXllclZlcnNpb25Qcm9wcyA9IHtcbiAgICAgICAgICAgIGxheWVyVmVyc2lvbk5hbWU6IGxheWVyTmFtZSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVSdW50aW1lczogWyBSdW50aW1lLk5PREVKU18yMl9YIF0sXG4gICAgICAgICAgICBjb2RlOiBDb2RlLmZyb21Bc3NldChidW5kbGVEaXIpLFxuICAgICAgICAgICAgY29tcGF0aWJsZUFyY2hpdGVjdHVyZXM6IFtBcmNoaXRlY3R1cmUuQVJNXzY0XSxcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBsYXllciA9IG5ldyBMYXllclZlcnNpb24odGhpcy5tYWluU3RhY2ssIGxheWVyTmFtZSArICctbGF5ZXInLCB7XG4gICAgICAgICAgICAuLi5kZWZhdWx0TGF5ZXJQcm9wcyxcbiAgICAgICAgICAgIC4uLmxheWVyQ29uZmlnLmxheWVyUHJvcHMsXG4gICAgICAgICAgICAuLi5sYXllclByb3BzLCAvLyB0aGUgbGF5ZXJQcm9wcyBmcm9tIHRoZSBkZWNvcmF0b3IgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgbGF5ZXJOYW1lLCBsYXllciwgT3V0cHV0VHlwZS5MQVlFUiwgJ2xheWVyVmVyc2lvbkFybicpO1xuXG4gICAgICAgIC8vIENsZWFuIHVwIHRoZSB0ZW1wb3Jhcnkgb3V0cHV0IGRpcmVjdG9yeSBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmIChsYXllckNvbmZpZy5jbGVhck91dHB1dERpcikge1xuICAgICAgICAgICAgY2xlYW51cERpcmVjdG9yeShvdXRwdXREaXIpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IHNjYW5zIGEgZGlyZWN0b3J5IGFuZCByZXR1cm5zIGEgbGlzdCBvZiBUeXBlU2NyaXB0IGZpbGVzLlxuICogQHBhcmFtIGRpcmVjdG9yeSAtIFRoZSBkaXJlY3RvcnkgdG8gc2Nhbi5cbiAqIEByZXR1cm5zIEFuIGFycmF5IG9mIFR5cGVTY3JpcHQgZmlsZSBwYXRocy5cbiAqL1xuZnVuY3Rpb24gc2NhbkRpcmVjdG9yeShkaXJlY3Rvcnk6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBsZXQgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgaXRlbXMgPSByZWFkZGlyU3luYyhkaXJlY3RvcnkpO1xuXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gcGF0aEpvaW4oZGlyZWN0b3J5LCBpdGVtKTtcbiAgICAgICAgY29uc3Qgc3RhdCA9IHN0YXRTeW5jKGZ1bGxQYXRoKTtcblxuICAgICAgICBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBmaWxlcyA9IGZpbGVzLmNvbmNhdChzY2FuRGlyZWN0b3J5KGZ1bGxQYXRoKSk7XG4gICAgICAgIH0gZWxzZSBpZiAoc3RhdC5pc0ZpbGUoKSAmJiBmdWxsUGF0aC5lbmRzV2l0aCgnLnRzJykpIHtcbiAgICAgICAgICAgIGZpbGVzLnB1c2goZnVsbFBhdGgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbGVzO1xufVxuXG5mdW5jdGlvbiBpc0xheWVyRW50cnkodGFyZ2V0OiBGdW5jdGlvbik6IGJvb2xlYW4ge1xuICAgIHJldHVybiAhIWdldExheWVyTmFtZSh0YXJnZXQpO1xufVxuXG5mdW5jdGlvbiBpc0dsb2JhbExheWVyKHRhcmdldDogRnVuY3Rpb24pOiBib29sZWFuIHtcbiAgICByZXR1cm4gIVJlZmxlY3QuZ2V0KHRhcmdldCwgJ25vdEdsb2JhbCcpO1xufVxuXG5mdW5jdGlvbiBnZXRMYXllck5hbWUodGFyZ2V0OiBGdW5jdGlvbikge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsICdsYXllck5hbWUnKTtcbn1cblxuZnVuY3Rpb24gZ2V0TGF5ZXJCdWlsZE9wdGlvbnModGFyZ2V0OiBGdW5jdGlvbik6IEJ1aWxkT3B0aW9ucyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRhcmdldCwgJ2J1aWxkT3B0aW9ucycpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGF5ZXJQcm9wcyh0YXJnZXQ6IEZ1bmN0aW9uKTogTGF5ZXJWZXJzaW9uUHJvcHMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsICdsYXllclByb3BzJyk7XG59XG5cbi8qKlxuICogQnVuZGxlcyBhIFR5cGVTY3JpcHQgZmlsZSB1c2luZyBlc2J1aWxkIHdpdGggdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBAcGFyYW0gZW50cnlGaWxlIC0gVGhlIGVudHJ5IGZpbGUgdG8gYnVuZGxlLlxuICogQHBhcmFtIG91dHB1dEZpbGUgLSBUaGUgb3V0cHV0IGZpbGUgcGF0aCBmb3IgdGhlIGJ1bmRsZS5cbiAqIEBwYXJhbSBidWlsZE9wdGlvbnMgLSBUaGUgYnVpbGQgb3B0aW9ucyBmb3IgZXNidWlsZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gYnVuZGxlV2l0aEVzYnVpbGQoZW50cnlGaWxlOiBzdHJpbmcsIG91dHB1dEZpbGU6IHN0cmluZywgYnVpbGRPcHRpb25zOiBCdWlsZE9wdGlvbnMpIHtcbiAgICBjb25zdCBkZWZhdWx0T3B0aW9uczogQnVpbGRPcHRpb25zID0ge1xuICAgICAgICBidW5kbGU6IHRydWUsXG4gICAgICAgIHBsYXRmb3JtOiAnbm9kZScsXG4gICAgICAgIHRhcmdldDogJ25vZGUxOCcsXG4gICAgICAgIG1pbmlmeTogZmFsc2UsXG4gICAgICAgIC8vIGtlZXBOYW1lczogdHJ1ZSwgLy8gS2VlcCB0aGUgbmFtZXMgaW4gdGhlIG1pbmlmaWVkIGNvZGUgZm9yIERJLXRva2Vuc1xuICAgICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICAgIC4uLmJ1aWxkT3B0aW9ucywgLy8gT3ZlcnJpZGUgd2l0aCBzcGVjaWZpYyBidWlsZCBvcHRpb25zXG4gICAgICAgIGV4dGVybmFsOiBbIC4uLihidWlsZE9wdGlvbnMuZXh0ZXJuYWwgfHwgW10pLCBcbiAgICAgICAgICAgIC8vIG1ha2Ugc3VyZSBhbGwgdGhlIGRlcGVuZGVuY2llcyBvZiBjb3JlLWZ3IGxheWVyIGFyZSBtYXJrZWQgYXMgZXh0ZXJuYWxcbiAgICAgICAgICAgICdAdGVuMjRncm91cC9mdzI0JyxcbiAgICAgICAgICAgICdAYXdzLXNkaycsXG4gICAgICAgICAgICAnQHNtaXRoeScsXG4gICAgICAgICAgICAnYXdzLWNkay1saWInLFxuICAgICAgICAgICAgJ2VzYnVpbGQnLFxuICAgICAgICBdLCAvLyBTcGVjaWZ5IGV4dGVybmFsIHBhY2thZ2VzXG4gICAgICAgIG91dGZpbGU6IG91dHB1dEZpbGUsXG4gICAgICAgIGVudHJ5UG9pbnRzOiBbZW50cnlGaWxlXSxcbiAgICB9O1xuXG4gICAgRGVmYXVsdExvZ2dlci5kZWJ1ZyhgYnVuZGxlV2l0aEVzYnVpbGQ6IEJ1bmRsaW5nICR7ZW50cnlGaWxlfSBpbnRvICR7b3V0cHV0RmlsZX0gd2l0aCBvcHRpb25zOmAsIGRlZmF1bHRPcHRpb25zKTtcbiAgICBhd2FpdCBidWlsZChkZWZhdWx0T3B0aW9ucyk7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlcyBoYXNoIG9mIGEgZmlsZSdzIGNvbnRlbnRzXG4gKi9cbmZ1bmN0aW9uIGNhbGN1bGF0ZUZpbGVIYXNoKGZpbGVQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkRmlsZVN5bmMoZmlsZVBhdGgpO1xuICAgIHJldHVybiBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoY29udGVudCkuZGlnZXN0KCdoZXgnKTtcbn1cblxuLyoqXG4gKiBDb21wYXJlIHR3byBkaXJlY3RvcmllcyBhbmQgY2hlY2sgaWYgdGhlaXIgY29udGVudHMgYXJlIGlkZW50aWNhbFxuICovXG5mdW5jdGlvbiBhcmVEaXJlY3Rvcmllc0lkZW50aWNhbChkaXIxOiBzdHJpbmcsIGRpcjI6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGlmICghZXhpc3RzU3luYyhkaXIxKSB8fCAhZXhpc3RzU3luYyhkaXIyKSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZmlsZXMxID0gcmVhZGRpclN5bmMoZGlyMSwgeyByZWN1cnNpdmU6IHRydWUgfSkgYXMgc3RyaW5nW107XG4gICAgICAgIGNvbnN0IGZpbGVzMiA9IHJlYWRkaXJTeW5jKGRpcjIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pIGFzIHN0cmluZ1tdO1xuXG4gICAgICAgIGlmIChmaWxlczEubGVuZ3RoICE9PSBmaWxlczIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgcmV0dXJuIGZpbGVzMS5ldmVyeShmaWxlID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbGUxUGF0aCA9IHBhdGhKb2luKGRpcjEsIGZpbGUpO1xuICAgICAgICAgICAgY29uc3QgZmlsZTJQYXRoID0gcGF0aEpvaW4oZGlyMiwgZmlsZSk7XG5cbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhmaWxlMlBhdGgpKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGNvbnN0IHN0YXQxID0gbHN0YXRTeW5jKGZpbGUxUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBzdGF0MiA9IGxzdGF0U3luYyhmaWxlMlBhdGgpO1xuXG4gICAgICAgICAgICBpZiAoc3RhdDEuaXNEaXJlY3RvcnkoKSAhPT0gc3RhdDIuaXNEaXJlY3RvcnkoKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgaWYgKHN0YXQxLmlzRGlyZWN0b3J5KCkpIHJldHVybiB0cnVlO1xuXG4gICAgICAgICAgICByZXR1cm4gY2FsY3VsYXRlRmlsZUhhc2goZmlsZTFQYXRoKSA9PT0gY2FsY3VsYXRlRmlsZUhhc2goZmlsZTJQYXRoKTtcbiAgICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbn1cblxuLyoqXG4gKiBNb3ZlIGRpcmVjdG9yeSBjb250ZW50cyBmcm9tIHNvdXJjZSB0byB0YXJnZXRcbiAqL1xuZnVuY3Rpb24gbW92ZURpcmVjdG9yeUNvbnRlbnRzKHNvdXJjZURpcjogc3RyaW5nLCB0YXJnZXREaXI6IHN0cmluZykge1xuICAgIGlmICghZXhpc3RzU3luYyh0YXJnZXREaXIpKSB7XG4gICAgICAgIG1rZGlyU3luYyh0YXJnZXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGVzID0gcmVhZGRpclN5bmMoc291cmNlRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KSBhcyBzdHJpbmdbXTtcbiAgICBmaWxlcy5mb3JFYWNoKGZpbGUgPT4ge1xuICAgICAgICBjb25zdCBzb3VyY2VQYXRoID0gcGF0aEpvaW4oc291cmNlRGlyLCBmaWxlKTtcbiAgICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IHBhdGhKb2luKHRhcmdldERpciwgZmlsZSk7XG5cbiAgICAgICAgaWYgKGxzdGF0U3luYyhzb3VyY2VQYXRoKS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmModGFyZ2V0UGF0aCkpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmModGFyZ2V0UGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAoZXhpc3RzU3luYyh0YXJnZXRQYXRoKSkge1xuICAgICAgICAgICAgICAgIHJtU3luYyh0YXJnZXRQYXRoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlbmFtZVN5bmMoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCk7XG4gICAgICAgIH1cbiAgICB9KTtcbn1cblxuLyoqXG4gKiBDbGVhbnMgdXAgYSB0ZW1wb3JhcnkgZGlyZWN0b3J5IGJ5IHJlbW92aW5nIGFsbCBmaWxlcyBhbmQgc3ViZGlyZWN0b3JpZXMuXG4gKiBAcGFyYW0gZGlyZWN0b3J5IC0gVGhlIGRpcmVjdG9yeSB0byBjbGVhbiB1cC5cbiAqL1xuZnVuY3Rpb24gY2xlYW51cERpcmVjdG9yeShkaXJlY3Rvcnk6IHN0cmluZykge1xuICAgIHRyeSB7XG4gICAgICAgIHJtU3luYyhkaXJlY3RvcnksIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBidW5kbGVXaXRoRXNidWlsZDogQ2xlYW5lZCB1cCB0ZW1wb3JhcnkgZGlyZWN0b3J5OiAke2RpcmVjdG9yeX1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmVycm9yKGBidW5kbGVXaXRoRXNidWlsZDogRmFpbGVkIHRvIGNsZWFuIHVwIGRpcmVjdG9yeSAke2RpcmVjdG9yeX06YCwgZXJyb3IpO1xuICAgIH1cbn1cblxuLyoqXG4gKiBJbnN0YWxscyBleHRlcm5hbCBkZXBlbmRlbmNpZXMgaW50byB0aGUgbGF5ZXIncyBub2RlX21vZHVsZXMgZGlyZWN0b3J5LlxuICogVGhpcyBpcyBjYWxsZWQgd2hlbiBidWlsZE9wdGlvbnMuZXh0ZXJuYWwgY29udGFpbnMgcGFja2FnZXMgdGhhdCBzaG91bGQgbm90IGJlIGJ1bmRsZWQuXG4gKiBcbiAqIEBwYXJhbSBsYXllclRlbXBEaXIgLSBUaGUgdGVtcG9yYXJ5IGRpcmVjdG9yeSBmb3IgdGhlIGxheWVyIChlLmcuLCBkaXN0L2xheWVyc190ZW1wL3NoYXJlZC1sYXllcilcbiAqIEBwYXJhbSBleHRlcm5hbFBhY2thZ2VzIC0gQXJyYXkgb2YgcGFja2FnZSBuYW1lcyB0byBpbnN0YWxsIChlLmcuLCBbJ2F4aW9zJywgJ2ZpcmViYXNlLWFkbWluJ10pXG4gKiBAcGFyYW0gbG9nZ2VyIC0gTG9nZ2VyIGluc3RhbmNlIGZvciBvdXRwdXRcbiAqL1xuYXN5bmMgZnVuY3Rpb24gaW5zdGFsbEV4dGVybmFsRGVwZW5kZW5jaWVzKGxheWVyVGVtcERpcjogc3RyaW5nLCBleHRlcm5hbFBhY2thZ2VzOiAoc3RyaW5nIHwgUmVnRXhwKVtdLCBsb2dnZXI6IGFueSkge1xuICAgIC8vIEZpbHRlciBvdXQgcmVnZXggcGF0dGVybnMgYW5kIGZyYW1ld29yay9idWlsdC1pbiBtb2R1bGVzXG4gICAgY29uc3QgcGFja2FnZU5hbWVzID0gZXh0ZXJuYWxQYWNrYWdlcy5maWx0ZXIocGtnID0+IFxuICAgICAgICB0eXBlb2YgcGtnID09PSAnc3RyaW5nJyAmJiBcbiAgICAgICAgIXBrZy5zdGFydHNXaXRoKCdAYXdzLXNkaycpICYmIFxuICAgICAgICAhcGtnLnN0YXJ0c1dpdGgoJ0BzbWl0aHknKSAmJlxuICAgICAgICAhcGtnLnN0YXJ0c1dpdGgoJ2F3cy1jZGstbGliJykgJiZcbiAgICAgICAgcGtnICE9PSAnZXNidWlsZCcgJiZcbiAgICAgICAgcGtnICE9PSAnQHRlbjI0Z3JvdXAvZncyNCdcbiAgICApIGFzIHN0cmluZ1tdO1xuXG4gICAgaWYgKHBhY2thZ2VOYW1lcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGxvZ2dlci5pbmZvKGBJbnN0YWxsaW5nIGV4dGVybmFsIGRlcGVuZGVuY2llczogJHtwYWNrYWdlTmFtZXMuam9pbignLCAnKX1gKTtcblxuICAgIGNvbnN0IG5vZGVqc0RpciA9IHBhdGhKb2luKGxheWVyVGVtcERpciwgJ25vZGVqcycpO1xuICAgIGNvbnN0IG5vZGVNb2R1bGVzRGlyID0gcGF0aEpvaW4obm9kZWpzRGlyLCAnbm9kZV9tb2R1bGVzJyk7XG4gICAgXG4gICAgLy8gQmFja3VwIGJ1bmRsZWQgY29kZSBpZiBpdCBleGlzdHMgKG5wbSBpbnN0YWxsIHdpbGwgd2lwZSBub2RlX21vZHVsZXMpXG4gICAgY29uc3QgYnVuZGxlZENvZGVCYWNrdXAgPSBwYXRoSm9pbihsYXllclRlbXBEaXIsICdfYnVuZGxlZF9jb2RlX2JhY2t1cCcpO1xuICAgIGlmIChleGlzdHNTeW5jKG5vZGVNb2R1bGVzRGlyKSkge1xuICAgICAgICAvLyBNb3ZlIGVudGlyZSBub2RlX21vZHVsZXMgdG8gYmFja3VwXG4gICAgICAgIHJlbmFtZVN5bmMobm9kZU1vZHVsZXNEaXIsIGJ1bmRsZWRDb2RlQmFja3VwKTtcbiAgICB9XG5cbiAgICAvLyBFbnN1cmUgZGlyZWN0b3JpZXMgZXhpc3QgZm9yIG5wbSBpbnN0YWxsXG4gICAgaWYgKCFleGlzdHNTeW5jKG5vZGVNb2R1bGVzRGlyKSkge1xuICAgICAgICBta2RpclN5bmMobm9kZU1vZHVsZXNEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBwYWNrYWdlLmpzb24gd2l0aCBvbmx5IHRoZSBleHRlcm5hbCBkZXBlbmRlbmNpZXNcbiAgICBjb25zdCB0ZW1wUGFja2FnZUpzb246IGFueSA9IHtcbiAgICAgICAgbmFtZTogJ2xheWVyLWRlcGVuZGVuY2llcycsXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXG4gICAgICAgIGRlcGVuZGVuY2llczoge31cbiAgICB9O1xuXG4gICAgLy8gUmVhZCB0aGUgcHJvamVjdCdzIHBhY2thZ2UuanNvbiB0byBnZXQgdmVyc2lvbiBudW1iZXJzXG4gICAgY29uc3QgcHJvamVjdFJvb3QgPSBwYXRoUmVzb2x2ZShwcm9jZXNzLmN3ZCgpKTtcbiAgICBjb25zdCBwcm9qZWN0UGFja2FnZUpzb25QYXRoID0gcGF0aEpvaW4ocHJvamVjdFJvb3QsICdwYWNrYWdlLmpzb24nKTtcbiAgICBcbiAgICBpZiAoIWV4aXN0c1N5bmMocHJvamVjdFBhY2thZ2VKc29uUGF0aCkpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oYHBhY2thZ2UuanNvbiBub3QgZm91bmQgYXQgJHtwcm9qZWN0UGFja2FnZUpzb25QYXRofSwgaW5zdGFsbGluZyBsYXRlc3QgdmVyc2lvbnNgKTtcbiAgICAgICAgcGFja2FnZU5hbWVzLmZvckVhY2gocGtnID0+IHtcbiAgICAgICAgICAgIHRlbXBQYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXNbcGtnXSA9ICdsYXRlc3QnO1xuICAgICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBwcm9qZWN0UGFja2FnZUpzb24gPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhwcm9qZWN0UGFja2FnZUpzb25QYXRoLCAndXRmLTgnKSk7XG4gICAgICAgIGNvbnN0IGFsbERlcHMgPSB7XG4gICAgICAgICAgICAuLi4ocHJvamVjdFBhY2thZ2VKc29uLmRlcGVuZGVuY2llcyB8fCB7fSksXG4gICAgICAgICAgICAuLi4ocHJvamVjdFBhY2thZ2VKc29uLmRldkRlcGVuZGVuY2llcyB8fCB7fSlcbiAgICAgICAgfTtcblxuICAgICAgICBwYWNrYWdlTmFtZXMuZm9yRWFjaChwa2cgPT4ge1xuICAgICAgICAgICAgaWYgKGFsbERlcHNbcGtnXSkge1xuICAgICAgICAgICAgICAgIHRlbXBQYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXNbcGtnXSA9IGFsbERlcHNbcGtnXTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYFBhY2thZ2UgJHtwa2d9IG5vdCBmb3VuZCBpbiBwcm9qZWN0IHBhY2thZ2UuanNvbiwgdXNpbmcgbGF0ZXN0YCk7XG4gICAgICAgICAgICAgICAgdGVtcFBhY2thZ2VKc29uLmRlcGVuZGVuY2llc1twa2ddID0gJ2xhdGVzdCc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIFdyaXRlIHRoZSB0ZW1wb3JhcnkgcGFja2FnZS5qc29uXG4gICAgY29uc3QgdGVtcFBhY2thZ2VKc29uUGF0aCA9IHBhdGhKb2luKG5vZGVqc0RpciwgJ3BhY2thZ2UuanNvbicpO1xuICAgIHdyaXRlRmlsZVN5bmModGVtcFBhY2thZ2VKc29uUGF0aCwgSlNPTi5zdHJpbmdpZnkodGVtcFBhY2thZ2VKc29uLCBudWxsLCAyKSk7XG5cbiAgICAvLyBJbnN0YWxsIGRlcGVuZGVuY2llc1xuICAgIHRyeSB7XG4gICAgICAgIGxvZ2dlci5pbmZvKGBSdW5uaW5nIG5wbSBpbnN0YWxsIGluICR7bm9kZWpzRGlyfWApO1xuICAgICAgICBleGVjU3luYygnbnBtIGluc3RhbGwgLS1vbWl0PWRldiAtLW5vLXBhY2thZ2UtbG9jaycsIHtcbiAgICAgICAgICAgIGN3ZDogbm9kZWpzRGlyLFxuICAgICAgICAgICAgc3RkaW86ICdpbmhlcml0J1xuICAgICAgICB9KTtcbiAgICAgICAgbG9nZ2VyLmluZm8oJ0V4dGVybmFsIGRlcGVuZGVuY2llcyBpbnN0YWxsZWQgc3VjY2Vzc2Z1bGx5Jyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gaW5zdGFsbCBleHRlcm5hbCBkZXBlbmRlbmNpZXM6JywgZXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG5cbiAgICAvLyBSZW1vdmUgdGhlIHRlbXBvcmFyeSBwYWNrYWdlLmpzb24gKGJ1dCBrZWVwIG5vZGVfbW9kdWxlcylcbiAgICBpZiAoZXhpc3RzU3luYyh0ZW1wUGFja2FnZUpzb25QYXRoKSkge1xuICAgICAgICBybVN5bmModGVtcFBhY2thZ2VKc29uUGF0aCk7XG4gICAgfVxuXG4gICAgLy8gUmVzdG9yZSBidW5kbGVkIGNvZGUgZnJvbSBiYWNrdXBcbiAgICBpZiAoZXhpc3RzU3luYyhidW5kbGVkQ29kZUJhY2t1cCkpIHtcbiAgICAgICAgbG9nZ2VyLmluZm8oJ1Jlc3RvcmluZyBidW5kbGVkIGNvZGUgaW50byBub2RlX21vZHVsZXMnKTtcbiAgICAgICAgLy8gQ29weSBjb250ZW50cyBmcm9tIGJhY2t1cCBpbnRvIG5vZGVfbW9kdWxlc1xuICAgICAgICBjb25zdCBiYWNrdXBDb250ZW50cyA9IHJlYWRkaXJTeW5jKGJ1bmRsZWRDb2RlQmFja3VwKTtcbiAgICAgICAgYmFja3VwQ29udGVudHMuZm9yRWFjaChpdGVtID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNvdXJjZVBhdGggPSBwYXRoSm9pbihidW5kbGVkQ29kZUJhY2t1cCwgaXRlbSk7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXRQYXRoID0gcGF0aEpvaW4obm9kZU1vZHVsZXNEaXIsIGl0ZW0pO1xuICAgICAgICAgICAgLy8gT25seSBjb3B5IGlmIHRhcmdldCBkb2Vzbid0IGV4aXN0IChkb24ndCBvdmVyd3JpdGUgbnBtLWluc3RhbGxlZCBwYWNrYWdlcylcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyh0YXJnZXRQYXRoKSkge1xuICAgICAgICAgICAgICAgIGlmIChsc3RhdFN5bmMoc291cmNlUGF0aCkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBDb3B5IGRpcmVjdG9yeSByZWN1cnNpdmVseVxuICAgICAgICAgICAgICAgICAgICBjb3B5RGlyZWN0b3J5KHNvdXJjZVBhdGgsIHRhcmdldFBhdGgpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGNvcHlGaWxlU3luYyhzb3VyY2VQYXRoLCB0YXJnZXRQYXRoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAvLyBDbGVhbiB1cCBiYWNrdXBcbiAgICAgICAgcm1TeW5jKGJ1bmRsZWRDb2RlQmFja3VwLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgbG9nZ2VyLmluZm8oJ0J1bmRsZWQgY29kZSByZXN0b3JlZCBzdWNjZXNzZnVsbHknKTtcbiAgICB9XG59XG5cbi8qKlxuICogUmVjdXJzaXZlbHkgY29weSBhIGRpcmVjdG9yeVxuICovXG5mdW5jdGlvbiBjb3B5RGlyZWN0b3J5KHNvdXJjZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZykge1xuICAgIGlmICghZXhpc3RzU3luYyh0YXJnZXQpKSB7XG4gICAgICAgIG1rZGlyU3luYyh0YXJnZXQsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cbiAgICBjb25zdCBpdGVtcyA9IHJlYWRkaXJTeW5jKHNvdXJjZSk7XG4gICAgaXRlbXMuZm9yRWFjaChpdGVtID0+IHtcbiAgICAgICAgY29uc3Qgc291cmNlUGF0aCA9IHBhdGhKb2luKHNvdXJjZSwgaXRlbSk7XG4gICAgICAgIGNvbnN0IHRhcmdldFBhdGggPSBwYXRoSm9pbih0YXJnZXQsIGl0ZW0pO1xuICAgICAgICBpZiAobHN0YXRTeW5jKHNvdXJjZVBhdGgpLmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIGNvcHlEaXJlY3Rvcnkoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb3B5RmlsZVN5bmMoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCk7XG4gICAgICAgIH1cbiAgICB9KTtcbn1cbiJdfQ==