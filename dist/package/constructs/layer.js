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
        // Check if output directory exists and compare contents
        const shouldUpdateOutput = !(0, fs_1.existsSync)(outputDir) || !areDirectoriesIdentical(tempOutputDir, outputDir);
        if (shouldUpdateOutput) {
            this.logger.info(`Content changed for layer ${layerName}, updating output`);
            // Clean existing output if it exists
            if ((0, fs_1.existsSync)(outputDir)) {
                (0, fs_1.rmSync)(outputDir, { recursive: true });
            }
            // Move contents from temp to output
            moveDirectoryContents(tempOutputDir, outputDir);
        }
        else {
            this.logger.warn(`No changes detected for layer ${layerName}, keeping existing code`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGF5ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9sYXllci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUF3WkEsc0NBRUM7QUF4WkQsMkNBQXdDO0FBQ3hDLHVDQUFvQztBQUNwQyx1REFBeUY7QUFDekYsd0NBQXNFO0FBQ3RFLHVEQUFzRztBQUN0RywrQkFBa0g7QUFDbEgsMkJBQTZIO0FBQzdILHFDQUE4QztBQUM5Qyw4Q0FBMkM7QUFFM0MsbUNBQW9DO0FBOEhwQzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBMkJHO0FBQ0gsTUFBYSxjQUFjO0lBY0g7SUFiWCxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxDQUFDO0lBQ3RDLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUM7SUFDM0IsWUFBWSxHQUFhLEVBQUUsQ0FBQztJQUM1QixNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUVsQjs7O09BR0c7SUFDSCxZQUFvQixNQUErQjtRQUEvQixXQUFNLEdBQU4sTUFBTSxDQUF5QjtRQUUvQyxlQUFlO1FBQ2YsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFO1lBQzNCLFdBQVcsQ0FBQyxJQUFJLEdBQUcsV0FBVyxDQUFDLElBQUksSUFBSSxtQkFBbUIsQ0FBQztZQUMzRCxJQUFJLFdBQVcsQ0FBQyxJQUFJLEtBQUssbUJBQW1CLEVBQUUsQ0FBQztnQkFDM0MsV0FBVyxDQUFDLGNBQWMsR0FBRyxXQUFXLENBQUMsY0FBYyxJQUFJLEtBQUssQ0FBQztZQUNyRSxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7UUFFSCxlQUFNLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQztJ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U0FBUyxFQUFFLENBQUMsQ0FBQztJQUMxRixDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNiLHVCQUFhLENBQUMsS0FBSyxDQUFDLG1EQUFtRCxTQUFTLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUNoRyxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENmbk91dHB1dCwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcblxuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmUvaGVscGVyXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgRGVmYXVsdExvZ2dlciwgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBBcmNoaXRlY3R1cmUsIENvZGUsIExheWVyVmVyc2lvbiwgTGF5ZXJWZXJzaW9uUHJvcHMsIFJ1bnRpbWUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IGJhc2VuYW1lIGFzIHBhdGhCYXNlTmFtZSwgcmVzb2x2ZSBhcyBwYXRoUmVzb2x2ZSwgam9pbiBhcyBwYXRoSm9pbiwgZXh0bmFtZSBhcyBwYXRoRXh0bmFtZSB9IGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgZXhpc3RzU3luYywgbWtkaXJTeW5jLCByZWFkZGlyU3luYywgc3RhdFN5bmMsIHJtU3luYywgbHN0YXRTeW5jLCBjb3B5RmlsZVN5bmMsIHJlbmFtZVN5bmMsIHJlYWRGaWxlU3luYyB9IGZyb20gJ2ZzJztcbmltcG9ydCB7IGJ1aWxkLCBCdWlsZE9wdGlvbnMgfSBmcm9tICdlc2J1aWxkJztcbmltcG9ydCB7IExheWVyRW50cnkgfSBmcm9tIFwiLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwiY3J5cHRvXCI7XG5cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB0aGUgUEFDS0FHRV9ESVJFQ1RPUlkgbW9kZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJUGFja2FnZURpcmVjdG9yeUNvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBuYW1lIG9mIHRoZSBsYXllci5cbiAgICAgKi9cbiAgICBsYXllck5hbWU6IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBzb3VyY2UgcGF0aCBvZiB0aGUgbGF5ZXIgZGlyZWN0b3J5LlxuICAgICAqL1xuICAgIHNvdXJjZVBhdGg6IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBtb2RlIG9mIHBhY2thZ2luZzogcGFja2FnZSB0aGUgd2hvbGUgZGlyZWN0b3J5LlxuICAgICAqL1xuICAgIG1vZGU/OiAnUEFDS0FHRV9ESVJFQ1RPUlknO1xuXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgcHJvcGVydGllcyBmb3IgdGhlIGxheWVyIHZlcnNpb24uXG4gICAgICovXG4gICAgbGF5ZXJQcm9wcz86IE9taXQ8TGF5ZXJWZXJzaW9uUHJvcHMsICdjb2RlJz47XG5cbiAgICAvKipcbiAgICAgKiBQcmlvcml0eSBmb3IgbGF5ZXIgbG9hZGluZyBvcmRlci4gTG93ZXIgbnVtYmVycyBsb2FkIGZpcnN0LlxuICAgICAqIElmIG5vdCBzcGVjaWZpZWQsIHByaW9yaXR5IGlzIGF1dG8tYXNzaWduZWQgYXMgKGFycmF5X2luZGV4ICsgMTApLlxuICAgICAqIFxuICAgICAqIFByaW9yaXR5IHJhbmdlczpcbiAgICAgKiAtIDAtOTogUmVzZXJ2ZWQgZm9yIGZyYW1ld29yayBsYXllcnMgKGZ3MjQgY29yZSA9IDApXG4gICAgICogLSAxMCs6IFVzZXIvYXBwbGljYXRpb24gbGF5ZXJzIChhdXRvLWFzc2lnbmVkIG9yIGV4cGxpY2l0KVxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogLy8gQXV0by1hc3NpZ25lZCBwcmlvcml0aWVzIChyZWNvbW1lbmRlZCk6XG4gICAgICogY29uc3QgbGF5ZXJzID0gbmV3IERJTGF5ZXJDb25zdHJ1Y3QoW1xuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9kaS50cycgfSwgICAgICAgIC8vIHByaW9yaXR5OiAxMFxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9zaGFyZWQudHMnIH0sICAgIC8vIHByaW9yaXR5OiAxMVxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9maXJlYmFzZS50cycgfSAgIC8vIHByaW9yaXR5OiAxMlxuICAgICAqIF0pO1xuICAgICAqIFxuICAgICAqIC8vIEV4cGxpY2l0IHByaW9yaXRpZXMgKGZvciBzcGVjaWFsIGNhc2VzKTpcbiAgICAgKiBjb25zdCBsYXllcnMgPSBuZXcgRElMYXllckNvbnN0cnVjdChbXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2RpLnRzJywgcHJpb3JpdHk6IDEwIH0sICAgICAgLy8gTG9hZCBmaXJzdFxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9maXJlYmFzZS50cycsIHByaW9yaXR5OiAyMCB9LCAvLyBMb2FkIGxhc3RcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vc2hhcmVkLnRzJywgcHJpb3JpdHk6IDE1IH0gICAvLyBMb2FkIGluIGJldHdlZW5cbiAgICAgKiBdKTtcbiAgICAgKi9cbiAgICBwcmlvcml0eT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB0aGUgQlVJTERfQU5EX1BBQ0tBR0UgbW9kZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIHNvdXJjZSBwYXRoIG9mIHRoZSBsYXllciwgd2hpY2ggY2FuIGJlIGEgZGlyZWN0b3J5IG9yIGEgZmlsZS5cbiAgICAgKi9cbiAgICBzb3VyY2VQYXRoOiBzdHJpbmc7XG4gICAgXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgcHJvcGVydGllcyBmb3IgdGhlIGxheWVyIHZlcnNpb24uXG4gICAgICovXG4gICAgbGF5ZXJQcm9wcz86IE9taXQ8TGF5ZXJWZXJzaW9uUHJvcHMsICdjb2RlJz47XG5cbiAgICAvKipcbiAgICAgKiBUaGUgbW9kZSBvZiBwYWNrYWdpbmc6IHNjYW4gYW5kIGJ1aWxkIGluZGl2aWR1YWwgZmlsZXMuXG4gICAgICovXG4gICAgbW9kZTogJ0JVSUxEX0FORF9QQUNLQUdFJztcblxuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIGN1c3RvbSBkaXN0cmlidXRpb24gZGlyZWN0b3J5IGZvciB0aGUgYnVpbGQgb3V0cHV0cy5cbiAgICAgKi9cbiAgICBkaXN0RGlyZWN0b3J5Pzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogRmxhZyB0byBjbGVhciB0aGUgb3V0cHV0IGRpcmVjdG9yeSBhZnRlciBwYWNrYWdpbmc7IGRlZmF1bHRzIHRvIGZhbHNlLlxuICAgICAqL1xuICAgIGNsZWFyT3V0cHV0RGlyPzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyYWJsZSBvdXRwdXQgcGF0aCBmb3IgdGhlIHBhY2thZ2UuXG4gICAgICovIFxuICAgIHBhY2thZ2VQYXRoPzogc3RyaW5nO1xuXG4gICAgXG4gICAgbm90R2xvYmFsPzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIFByaW9yaXR5IGZvciBsYXllciBsb2FkaW5nIG9yZGVyLiBMb3dlciBudW1iZXJzIGxvYWQgZmlyc3QuXG4gICAgICogSWYgbm90IHNwZWNpZmllZCwgcHJpb3JpdHkgaXMgYXV0by1hc3NpZ25lZCBhcyAoYXJyYXlfaW5kZXggKyAxMCkuXG4gICAgICogXG4gICAgICogUHJpb3JpdHkgcmFuZ2VzOlxuICAgICAqIC0gMC05OiBSZXNlcnZlZCBmb3IgZnJhbWV3b3JrIGxheWVycyAoZncyNCBjb3JlID0gMClcbiAgICAgKiAtIDEwKzogVXNlci9hcHBsaWNhdGlvbiBsYXllcnMgKGF1dG8tYXNzaWduZWQgb3IgZXhwbGljaXQpXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiAvLyBBdXRvLWFzc2lnbmVkIHByaW9yaXRpZXMgKHJlY29tbWVuZGVkKTpcbiAgICAgKiBjb25zdCBsYXllcnMgPSBuZXcgRElMYXllckNvbnN0cnVjdChbXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2RpLnRzJyB9LCAgICAgICAgLy8gcHJpb3JpdHk6IDEwXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL3NoYXJlZC50cycgfSwgICAgLy8gcHJpb3JpdHk6IDExXG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2ZpcmViYXNlLnRzJyB9ICAgLy8gcHJpb3JpdHk6IDEyXG4gICAgICogXSk7XG4gICAgICogXG4gICAgICogLy8gRXhwbGljaXQgcHJpb3JpdGllcyAoZm9yIHNwZWNpYWwgY2FzZXMpOlxuICAgICAqIGNvbnN0IGxheWVycyA9IG5ldyBESUxheWVyQ29uc3RydWN0KFtcbiAgICAgKiAgIHsgc291cmNlUGF0aDogJy4vZGkudHMnLCBwcmlvcml0eTogMTAgfSwgICAgICAvLyBMb2FkIGZpcnN0XG4gICAgICogICB7IHNvdXJjZVBhdGg6ICcuL2ZpcmViYXNlLnRzJywgcHJpb3JpdHk6IDIwIH0sIC8vIExvYWQgbGFzdFxuICAgICAqICAgeyBzb3VyY2VQYXRoOiAnLi9zaGFyZWQudHMnLCBwcmlvcml0eTogMTUgfSAgIC8vIExvYWQgaW4gYmV0d2VlblxuICAgICAqIF0pO1xuICAgICAqL1xuICAgIHByaW9yaXR5PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIGxheWVyIGNvbnN0cnVjdC5cbiAqIFxuICogTGF5ZXJzIGFyZSBwcm9jZXNzZWQgaW4gcGFyYWxsZWwgZm9yIHNwZWVkLCBidXQgbG9hZGVkIGF0IHJ1bnRpbWUgaW4gcHJpb3JpdHkgb3JkZXIuXG4gKiBQcmlvcml0eSBkZXRlcm1pbmVzIHRoZSBvcmRlciBpbiB3aGljaCBsYXllcnMgaW5pdGlhbGl6ZSB3aGVuIExhbWJkYSBjb2xkIHN0YXJ0cy5cbiAqIFxuICogQHNlZSBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnLnByaW9yaXR5IGZvciBwcmlvcml0eSBkZXRhaWxzXG4gKi9cbmV4cG9ydCB0eXBlIElMYXllckNvbnN0cnVjdENvbmZpZyA9IElQYWNrYWdlRGlyZWN0b3J5Q29uZmlnIHwgSUJ1aWxkQW5kUGFja2FnZUNvbmZpZztcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgY29uc3RydWN0IGZvciBjcmVhdGluZyBMYW1iZGEgbGF5ZXJzLlxuICogXG4gKiBMYXllcnMgYXJlIGJ1aWx0IGluIHBhcmFsbGVsIGZvciBwZXJmb3JtYW5jZSwgYnV0IGluaXRpYWxpemUgYXQgTGFtYmRhIHJ1bnRpbWVcbiAqIGluIHByaW9yaXR5IG9yZGVyLiBUaGlzIGVuc3VyZXMgY29ycmVjdCBkZXBlbmRlbmN5IGxvYWRpbmcgKGUuZy4sIERJIGNvbnRhaW5lclxuICogbG9hZHMgYmVmb3JlIGxheWVycyB0aGF0IHVzZSBpdCkuXG4gKiBcbiAqIFByaW9yaXR5IFN5c3RlbTpcbiAqIC0gMC05OiBSZXNlcnZlZCBmb3IgZnJhbWV3b3JrIGxheWVycyAoZncyNCBjb3JlID0gMClcbiAqIC0gMTArOiBBcHBsaWNhdGlvbiBsYXllcnMgKGF1dG8tYXNzaWduZWQgc3RhcnRpbmcgYXQgMTAsIG9yIHNldCBleHBsaWNpdGx5KVxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIEJhc2ljIHVzYWdlIHdpdGggYXV0by1wcmlvcml0eSAocmVjb21tZW5kZWQpXG4gKiBjb25zdCBkaUxheWVyID0gbmV3IERJTGF5ZXJDb25zdHJ1Y3QoW1xuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9kaS50cycgfSwgICAgICAgICAgICAgIC8vIHByaW9yaXR5OiAxMCAoYXV0bylcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvY29uZmlnL3NoYXJlZC50cycgfSwgICAvLyBwcmlvcml0eTogMTEgKGF1dG8pXG4gKiAgIHsgc291cmNlUGF0aDogJy4vc3JjL2NvbmZpZy9maXJlYmFzZS50cycgfSAgLy8gcHJpb3JpdHk6IDEyIChhdXRvKVxuICogXSk7XG4gKiBcbiAqIC8vIEFkdmFuY2VkIHVzYWdlIHdpdGggZXhwbGljaXQgcHJpb3JpdGllc1xuICogY29uc3QgZGlMYXllciA9IG5ldyBESUxheWVyQ29uc3RydWN0KFtcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvZGkudHMnLCBwcmlvcml0eTogMTAgfSwgICAgICAgIC8vIExvYWQgZmlyc3RcbiAqICAgeyBzb3VyY2VQYXRoOiAnLi9zcmMvY29uZmlnL2ZpcmViYXNlLnRzJywgcHJpb3JpdHk6IDIwIH0sIC8vIExvYWQgbGFzdFxuICogICB7IHNvdXJjZVBhdGg6ICcuL3NyYy9jb25maWcvc2hhcmVkLnRzJywgcHJpb3JpdHk6IDE1IH0gICAgLy8gTG9hZCBpbiBiZXR3ZWVuXG4gKiBdKTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgTGF5ZXJDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoTGF5ZXJDb25zdHJ1Y3QpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgXG4gICAgbmFtZSA9IExheWVyQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgTGF5ZXJDb25zdHJ1Y3QgaW5zdGFuY2UuXG4gICAgICogQHBhcmFtIGNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgTGF5ZXJDb25zdHJ1Y3QuXG4gICAgICovXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSBjb25maWc6IElMYXllckNvbnN0cnVjdENvbmZpZ1tdKSB7XG4gICAgICAgIFxuICAgICAgICAvLyBhZGQgZGVmYXVsdHNcbiAgICAgICAgY29uZmlnLmZvckVhY2goKGxheWVyQ29uZmlnKSA9PiB7XG4gICAgICAgICAgICBsYXllckNvbmZpZy5tb2RlID0gbGF5ZXJDb25maWcubW9kZSB8fCAnUEFDS0FHRV9ESVJFQ1RPUlknO1xuICAgICAgICAgICAgaWYgKGxheWVyQ29uZmlnLm1vZGUgPT09ICdCVUlMRF9BTkRfUEFDS0FHRScpIHtcbiAgICAgICAgICAgICAgICBsYXllckNvbmZpZy5jbGVhck91dHB1dERpciA9IGxheWVyQ29uZmlnLmNsZWFyT3V0cHV0RGlyID8/IGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhjb25maWcsICdMQVlFUicpO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgLy8gQXNzaWduIHByaW9yaXR5IHRvIGVhY2ggbGF5ZXI6IHVzZSBleHBsaWNpdCBwcmlvcml0eSBpZiBzZXQsIG90aGVyd2lzZSB1c2UgYXJyYXkgaW5kZXggKyAxMFxuICAgICAgICAvLyBQcmlvcml0eSAwLTkgcmVzZXJ2ZWQgZm9yIGZyYW1ld29yayBsYXllcnMgKGZ3MjQgY29yZSA9IDApXG4gICAgICAgIC8vIFVzZXIgbGF5ZXJzIHN0YXJ0IGF0IDEwKyB0byBlbnN1cmUgZnJhbWV3b3JrIGxheWVycyBhbHdheXMgbG9hZCBmaXJzdFxuICAgICAgICB0aGlzLmNvbmZpZy5mb3JFYWNoKChsYXllckNvbmZpZywgaW5kZXgpID0+IHtcbiAgICAgICAgICAgIGlmICghbGF5ZXJDb25maWcucHJpb3JpdHkgJiYgbGF5ZXJDb25maWcucHJpb3JpdHkgIT09IDApIHtcbiAgICAgICAgICAgICAgICBsYXllckNvbmZpZy5wcmlvcml0eSA9IGluZGV4ICsgMTA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFByb2Nlc3MgbGF5ZXJzIGluIHBhcmFsbGVsIGZvciBzcGVlZCB3aGlsZSByZXNwZWN0aW5nIHByaW9yaXR5LWJhc2VkIGxvYWRpbmcgb3JkZXJcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwodGhpcy5jb25maWcubWFwKGFzeW5jIChsYXllckNvbmZpZykgPT4ge1xuICAgICAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sobGF5ZXJDb25maWcuc3RhY2tOYW1lIHx8IHRoaXMuZncyNC5nZXRDb25maWcoKS5sYXllclN0YWNrTmFtZSwgbGF5ZXJDb25maWcucGFyZW50U3RhY2tOYW1lKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJQcm9jZXNzaW5nIGxheWVyOlwiLCBsYXllckNvbmZpZyk7XG5cbiAgICAgICAgICAgIGlmIChsYXllckNvbmZpZy5tb2RlID09PSAnUEFDS0FHRV9ESVJFQ1RPUlknKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wYWNrYWdlRGlyZWN0b3J5KGxheWVyQ29uZmlnKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAobGF5ZXJDb25maWcubW9kZSA9PT0gJ0JVSUxEX0FORF9QQUNLQUdFJykge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuc2NhbkFuZFBhY2thZ2VGaWxlcyhsYXllckNvbmZpZyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBtb2RlIGZvciBsYXllciAke2xheWVyQ29uZmlnfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGFja2FnZXMgYSBkaXJlY3RvcnkgYXMgYSBMYW1iZGEgbGF5ZXIuXG4gICAgICogQHBhcmFtIGxheWVyQ29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBsYXllci5cbiAgICAgKiBAcGFyYW0gbWFpblN0YWNrIC0gVGhlIG1haW4gc3RhY2sgZm9yIGRlcGxveWluZyByZXNvdXJjZXMuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBwYWNrYWdlRGlyZWN0b3J5KGxheWVyQ29uZmlnOiBJUGFja2FnZURpcmVjdG9yeUNvbmZpZykge1xuICAgICAgICBjb25zdCBkZWZhdWx0TGF5ZXJQcm9wczogTGF5ZXJWZXJzaW9uUHJvcHMgPSB7XG4gICAgICAgICAgICBsYXllclZlcnNpb25OYW1lOiBsYXllckNvbmZpZy5sYXllck5hbWUsXG4gICAgICAgICAgICBjb21wYXRpYmxlUnVudGltZXM6IFsgUnVudGltZS5OT0RFSlNfMjJfWCBdLFxuICAgICAgICAgICAgY29kZTogQ29kZS5mcm9tQXNzZXQobGF5ZXJDb25maWcuc291cmNlUGF0aCksXG4gICAgICAgICAgICBjb21wYXRpYmxlQXJjaGl0ZWN0dXJlczogW0FyY2hpdGVjdHVyZS5BUk1fNjRdLFxuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgY29uc3QgbGF5ZXIgPSBuZXcgTGF5ZXJWZXJzaW9uKHRoaXMubWFpblN0YWNrLCBsYXllckNvbmZpZy5sYXllck5hbWUgKyAnLWxheWVyJywge1xuICAgICAgICAgICAgLi4uZGVmYXVsdExheWVyUHJvcHMsXG4gICAgICAgICAgICAuLi5sYXllckNvbmZpZy5sYXllclByb3BzLFxuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgbGF5ZXJDb25maWcubGF5ZXJOYW1lLCBsYXllciwgT3V0cHV0VHlwZS5MQVlFUiwgJ2xheWVyVmVyc2lvbkFybicpO1xuXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2NhbnMgYSBkaXJlY3RvcnkgZm9yIFR5cGVTY3JpcHQgZmlsZXMgYW5kIGNyZWF0ZXMgTGFtYmRhIGxheWVycyBmb3IgdGhlbS5cbiAgICAgKiBAcGFyYW0gbGF5ZXJDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIGxheWVyLlxuICAgICAqIEBwYXJhbSBtYWluU3RhY2sgLSBUaGUgbWFpbiBzdGFjayBmb3IgZGVwbG95aW5nIHJlc291cmNlcy5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHNjYW5BbmRQYWNrYWdlRmlsZXMobGF5ZXJDb25maWc6IElCdWlsZEFuZFBhY2thZ2VDb25maWcpIHtcbiAgICAgICAgY29uc3QgZGlzdERpcmVjdG9yeSA9IGxheWVyQ29uZmlnLmRpc3REaXJlY3RvcnkgfHwgcGF0aEpvaW4oX19kaXJuYW1lLCAnLi4vLi4vZGlzdCcpO1xuICAgICAgICBjb25zdCBzb3VyY2VEaXJlY3RvcnlPckZpbGVOYW1lID0gcGF0aFJlc29sdmUobGF5ZXJDb25maWcuc291cmNlUGF0aCk7XG4gICAgICAgIGNvbnN0IHRzRmlsZXMgPSBsc3RhdFN5bmMoc291cmNlRGlyZWN0b3J5T3JGaWxlTmFtZSkuaXNEaXJlY3RvcnkoKVxuICAgICAgICAgICAgPyBzY2FuRGlyZWN0b3J5KHNvdXJjZURpcmVjdG9yeU9yRmlsZU5hbWUpXG4gICAgICAgICAgICA6IFtzb3VyY2VEaXJlY3RvcnlPckZpbGVOYW1lXTtcblxuICAgICAgICAvLyBQcm9jZXNzIGZpbGVzIGluIHBhcmFsbGVsIG5vdyB0aGF0IHdlIGhhdmUgcHJpb3JpdHktYmFzZWQgb3JkZXJpbmdcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwodHNGaWxlcy5tYXAoYXN5bmMgKGZpbGUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMudHJ5Q3JlYXRlTGF5ZXJGb3JGaWxlKGZpbGUsIGRpc3REaXJlY3RvcnksIGxheWVyQ29uZmlnKTtcbiAgICAgICAgfSkpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEF0dGVtcHRzIHRvIGNyZWF0ZSBhIExhbWJkYSBsYXllciBmb3IgYSBnaXZlbiBUeXBlU2NyaXB0IGZpbGUuXG4gICAgICogQHBhcmFtIGZpbGUgLSBUaGUgcGF0aCB0byB0aGUgVHlwZVNjcmlwdCBmaWxlLlxuICAgICAqIEBwYXJhbSBkaXN0RGlyZWN0b3J5IC0gVGhlIG91dHB1dCBkaXJlY3RvcnkgZm9yIHRoZSBidWlsZC5cbiAgICAgKiBAcGFyYW0gbWFpblN0YWNrIC0gVGhlIG1haW4gc3RhY2sgZm9yIGRlcGxveWluZyByZXNvdXJjZXMuXG4gICAgICogQHBhcmFtIGxheWVyQ29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBsYXllci5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHRyeUNyZWF0ZUxheWVyRm9yRmlsZShmaWxlOiBzdHJpbmcsIGRpc3REaXJlY3Rvcnk6IHN0cmluZywgbGF5ZXJDb25maWc6IElCdWlsZEFuZFBhY2thZ2VDb25maWcpIHtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IG1vZHVsZUV4cG9ydHMgPSBhd2FpdCBpbXBvcnQoZmlsZSk7XG5cbiAgICAgICAgY29uc3QgZm91bmRMYXllckRlc2NyaXB0b3JOYW1lID0gT2JqZWN0LmtleXMobW9kdWxlRXhwb3J0cykuZmluZCgoa2V5KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBleHBvcnRlZCA9IG1vZHVsZUV4cG9ydHNba2V5XTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgZXhwb3J0ZWQgPT09ICdmdW5jdGlvbicgJiYgaXNMYXllckVudHJ5KGV4cG9ydGVkKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBleHBvcnRlZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gIFxuICAgICAgICBpZighZm91bmRMYXllckRlc2NyaXB0b3JOYW1lKXtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIExheWVyRW50cnkgZm91bmQgaW4gZmlsZSAke2ZpbGV9LiBXaWxsIHVzZSBEZWZhdWx0IG9wdGlvbnMuYCk7XG4gICAgICAgIH1cblxuICAgICAgICBMYXllckVudHJ5KHsgbm90R2xvYmFsOiBsYXllckNvbmZpZy5ub3RHbG9iYWwgPz8gZmFsc2UgfSlcbiAgICAgICAgY2xhc3MgRW1wdHlMYXllckRlc2NyaXB0b3Ige31cblxuICAgICAgICAvLyBpZiBubyBsYXllciBkZXNjcmlwdG9yIGZvdW5kIGluIHRoZSBmaWxlLCBjcmVhdGUgYW4gZW1wdHkgY2xhc3Mgd2hpY2ggd2lsbCB1c2UgZGVmYXVsdCBvcHRpb25zXG4gICAgICAgIGNvbnN0IGxheWVyRGVzY3JpcHRvciA9IGZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSA/IG1vZHVsZUV4cG9ydHNbZm91bmRMYXllckRlc2NyaXB0b3JOYW1lXSA6IEVtcHR5TGF5ZXJEZXNjcmlwdG9yO1xuXG4gICAgICAgIGNvbnN0IGJ1aWxkT3B0aW9ucyA9IGdldExheWVyQnVpbGRPcHRpb25zKGxheWVyRGVzY3JpcHRvcikgfHwge307XG5cbiAgICAgICAgY29uc3QgZmlsZUJhc2VOYW1lID0gcGF0aEJhc2VOYW1lKGZpbGUsIHBhdGhFeHRuYW1lKGZpbGUpKTtcbiAgICAgICAgY29uc3QgbGF5ZXJOYW1lID0gZ2V0TGF5ZXJOYW1lKGxheWVyRGVzY3JpcHRvcikgfHwgZmlsZUJhc2VOYW1lO1xuICAgICAgICBjb25zdCBjb25maWd1cmVkT3V0cHV0UGF0aCA9IGBub2RlanMvbm9kZV9tb2R1bGVzLyR7bGF5ZXJDb25maWcucGFja2FnZVBhdGggPz8gJyd9YCA7XG4gICAgXG4gICAgICAgIGNvbnN0IG91dHB1dERpciA9IHBhdGhKb2luKGRpc3REaXJlY3RvcnksIGxheWVyTmFtZSwgY29uZmlndXJlZE91dHB1dFBhdGgsIGZpbGVCYXNlTmFtZSk7XG4gICAgICAgIGNvbnN0IGJ1bmRsZURpciA9IHBhdGhKb2luKGRpc3REaXJlY3RvcnksIGxheWVyTmFtZSk7XG5cbiAgICAgICAgY29uc3QgdGVtcERpciA9IHBhdGhKb2luKGRpc3REaXJlY3RvcnksICdsYXllcnNfdGVtcCcsIGxheWVyTmFtZSk7XG4gICAgICAgIGNvbnN0IHRlbXBPdXRwdXREaXIgPSBwYXRoSm9pbih0ZW1wRGlyLCBjb25maWd1cmVkT3V0cHV0UGF0aCwgZmlsZUJhc2VOYW1lKTtcbiAgICAgICAgY29uc3QgdGVtcE91dHB1dEZpbGUgPSBwYXRoSm9pbih0ZW1wT3V0cHV0RGlyLCAnaW5kZXguanMnKTtcblxuICAgICAgICAvLyBFbnN1cmUgdGVtcCBkaXJlY3RvcnkgZXhpc3RzXG4gICAgICAgIGlmICghZXhpc3RzU3luYyh0ZW1wT3V0cHV0RGlyKSkge1xuICAgICAgICAgICAgbWtkaXJTeW5jKHRlbXBPdXRwdXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQnVpbGQgdG8gdGVtcG9yYXJ5IGRpcmVjdG9yeSBmaXJzdFxuICAgICAgICBhd2FpdCBidW5kbGVXaXRoRXNidWlsZChmaWxlLCB0ZW1wT3V0cHV0RmlsZSwgYnVpbGRPcHRpb25zKTtcblxuICAgICAgICAvLyBDaGVjayBpZiBvdXRwdXQgZGlyZWN0b3J5IGV4aXN0cyBhbmQgY29tcGFyZSBjb250ZW50c1xuICAgICAgICBjb25zdCBzaG91bGRVcGRhdGVPdXRwdXQgPSAhZXhpc3RzU3luYyhvdXRwdXREaXIpIHx8ICFhcmVEaXJlY3Rvcmllc0lkZW50aWNhbCh0ZW1wT3V0cHV0RGlyLCBvdXRwdXREaXIpO1xuXG4gICAgICAgIGlmIChzaG91bGRVcGRhdGVPdXRwdXQpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbnRlbnQgY2hhbmdlZCBmb3IgbGF5ZXIgJHtsYXllck5hbWV9LCB1cGRhdGluZyBvdXRwdXRgKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ2xlYW4gZXhpc3Rpbmcgb3V0cHV0IGlmIGl0IGV4aXN0c1xuICAgICAgICAgICAgaWYgKGV4aXN0c1N5bmMob3V0cHV0RGlyKSkge1xuICAgICAgICAgICAgICAgIHJtU3luYyhvdXRwdXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBNb3ZlIGNvbnRlbnRzIGZyb20gdGVtcCB0byBvdXRwdXRcbiAgICAgICAgICAgIG1vdmVEaXJlY3RvcnlDb250ZW50cyh0ZW1wT3V0cHV0RGlyLCBvdXRwdXREaXIpO1xuXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBjaGFuZ2VzIGRldGVjdGVkIGZvciBsYXllciAke2xheWVyTmFtZX0sIGtlZXBpbmcgZXhpc3RpbmcgY29kZWApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gdGhpcyBpcyB0aGUgcGF0aCB0aGF0IHdpbGwgYmUgdXNlZCBpbiB0aGUgbGF5ZXIgaW1wb3J0IHN0YXRlbWVudFxuICAgICAgICBjb25zdCBsYXllckltcG9ydFBhdGggPSBwYXRoSm9pbignL29wdCcsIGNvbmZpZ3VyZWRPdXRwdXRQYXRoLCBmaWxlQmFzZU5hbWUsICdpbmRleC5qcycpO1xuICAgICAgICAvLyBwdXQgaXQgaW50byBmdzI0J3MgY29uZmlnIHNvIGl0IGNhbiBiZSBhZGRlZCB0byB0aGUgbGFtYmRhJ3MgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ2xheWVySW1wb3J0UGF0aCcsIGxheWVySW1wb3J0UGF0aCk7XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUobGF5ZXJOYW1lLCBsYXllckltcG9ydFBhdGgsICdsYXllckltcG9ydFBhdGgnKTtcblxuICAgICAgICBpZihpc0dsb2JhbExheWVyKGxheWVyRGVzY3JpcHRvcikpe1xuICAgICAgICAgICAgLy8gY29sbGVjdCBnbG9iYWwgbGF5ZXJzIGZvciBsYW1iZGFcbiAgICAgICAgICAgIHRoaXMuZncyNC5hZGRHbG9iYWxMYW1iZGFMYXllck5hbWVzKGxheWVyTmFtZSk7XG4gICAgICAgICAgICAvLyBjb2xsZWN0IGdsb2JhbCBlbnRyeS1wYWNrYWdlcyBmb3IgbGFtYmRhcyB3aXRoIHByaW9yaXR5IGZvciBjb3JyZWN0IGxvYWRpbmcgb3JkZXJcbiAgICAgICAgICAgIC8vIFByaW9yaXR5IGlzIGFsd2F5cyBzZXQgaW4gY29uc3RydWN0KCksIHNvIGl0IG11c3QgYmUgZGVmaW5lZCBoZXJlXG4gICAgICAgICAgICBpZiAobGF5ZXJDb25maWcucHJpb3JpdHkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTGF5ZXIgJHtsYXllck5hbWV9IGhhcyBubyBwcmlvcml0eS4gVGhpcyBzaG91bGQgbmV2ZXIgaGFwcGVuLmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5mdzI0LmFkZEdsb2JhbExhbWJkYUVudHJ5UGFja2FnZShgZW52OmxheWVySW1wb3J0UGF0aDoke2xheWVyTmFtZX1gLCBsYXllckNvbmZpZy5wcmlvcml0eSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYXllclByb3BzID0gZ2V0TGF5ZXJQcm9wcyhsYXllckRlc2NyaXB0b3IpO1xuXG4gICAgICAgIGNvbnN0IGRlZmF1bHRMYXllclByb3BzOiBMYXllclZlcnNpb25Qcm9wcyA9IHtcbiAgICAgICAgICAgIGxheWVyVmVyc2lvbk5hbWU6IGxheWVyTmFtZSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVSdW50aW1lczogWyBSdW50aW1lLk5PREVKU18yMl9YIF0sXG4gICAgICAgICAgICBjb2RlOiBDb2RlLmZyb21Bc3NldChidW5kbGVEaXIpLFxuICAgICAgICAgICAgY29tcGF0aWJsZUFyY2hpdGVjdHVyZXM6IFtBcmNoaXRlY3R1cmUuQVJNXzY0XSxcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBsYXllciA9IG5ldyBMYXllclZlcnNpb24odGhpcy5tYWluU3RhY2ssIGxheWVyTmFtZSArICctbGF5ZXInLCB7XG4gICAgICAgICAgICAuLi5kZWZhdWx0TGF5ZXJQcm9wcyxcbiAgICAgICAgICAgIC4uLmxheWVyQ29uZmlnLmxheWVyUHJvcHMsXG4gICAgICAgICAgICAuLi5sYXllclByb3BzLCAvLyB0aGUgbGF5ZXJQcm9wcyBmcm9tIHRoZSBkZWNvcmF0b3IgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgbGF5ZXJOYW1lLCBsYXllciwgT3V0cHV0VHlwZS5MQVlFUiwgJ2xheWVyVmVyc2lvbkFybicpO1xuXG4gICAgICAgIC8vIENsZWFuIHVwIHRoZSB0ZW1wb3Jhcnkgb3V0cHV0IGRpcmVjdG9yeSBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmIChsYXllckNvbmZpZy5jbGVhck91dHB1dERpcikge1xuICAgICAgICAgICAgY2xlYW51cERpcmVjdG9yeShvdXRwdXREaXIpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IHNjYW5zIGEgZGlyZWN0b3J5IGFuZCByZXR1cm5zIGEgbGlzdCBvZiBUeXBlU2NyaXB0IGZpbGVzLlxuICogQHBhcmFtIGRpcmVjdG9yeSAtIFRoZSBkaXJlY3RvcnkgdG8gc2Nhbi5cbiAqIEByZXR1cm5zIEFuIGFycmF5IG9mIFR5cGVTY3JpcHQgZmlsZSBwYXRocy5cbiAqL1xuZnVuY3Rpb24gc2NhbkRpcmVjdG9yeShkaXJlY3Rvcnk6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBsZXQgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgaXRlbXMgPSByZWFkZGlyU3luYyhkaXJlY3RvcnkpO1xuXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gcGF0aEpvaW4oZGlyZWN0b3J5LCBpdGVtKTtcbiAgICAgICAgY29uc3Qgc3RhdCA9IHN0YXRTeW5jKGZ1bGxQYXRoKTtcblxuICAgICAgICBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBmaWxlcyA9IGZpbGVzLmNvbmNhdChzY2FuRGlyZWN0b3J5KGZ1bGxQYXRoKSk7XG4gICAgICAgIH0gZWxzZSBpZiAoc3RhdC5pc0ZpbGUoKSAmJiBmdWxsUGF0aC5lbmRzV2l0aCgnLnRzJykpIHtcbiAgICAgICAgICAgIGZpbGVzLnB1c2goZnVsbFBhdGgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbGVzO1xufVxuXG5mdW5jdGlvbiBpc0xheWVyRW50cnkodGFyZ2V0OiBGdW5jdGlvbik6IGJvb2xlYW4ge1xuICAgIHJldHVybiAhIWdldExheWVyTmFtZSh0YXJnZXQpO1xufVxuXG5mdW5jdGlvbiBpc0dsb2JhbExheWVyKHRhcmdldDogRnVuY3Rpb24pOiBib29sZWFuIHtcbiAgICByZXR1cm4gIVJlZmxlY3QuZ2V0KHRhcmdldCwgJ25vdEdsb2JhbCcpO1xufVxuXG5mdW5jdGlvbiBnZXRMYXllck5hbWUodGFyZ2V0OiBGdW5jdGlvbikge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsICdsYXllck5hbWUnKTtcbn1cblxuZnVuY3Rpb24gZ2V0TGF5ZXJCdWlsZE9wdGlvbnModGFyZ2V0OiBGdW5jdGlvbik6IEJ1aWxkT3B0aW9ucyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRhcmdldCwgJ2J1aWxkT3B0aW9ucycpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGF5ZXJQcm9wcyh0YXJnZXQ6IEZ1bmN0aW9uKTogTGF5ZXJWZXJzaW9uUHJvcHMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsICdsYXllclByb3BzJyk7XG59XG5cbi8qKlxuICogQnVuZGxlcyBhIFR5cGVTY3JpcHQgZmlsZSB1c2luZyBlc2J1aWxkIHdpdGggdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBAcGFyYW0gZW50cnlGaWxlIC0gVGhlIGVudHJ5IGZpbGUgdG8gYnVuZGxlLlxuICogQHBhcmFtIG91dHB1dEZpbGUgLSBUaGUgb3V0cHV0IGZpbGUgcGF0aCBmb3IgdGhlIGJ1bmRsZS5cbiAqIEBwYXJhbSBidWlsZE9wdGlvbnMgLSBUaGUgYnVpbGQgb3B0aW9ucyBmb3IgZXNidWlsZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gYnVuZGxlV2l0aEVzYnVpbGQoZW50cnlGaWxlOiBzdHJpbmcsIG91dHB1dEZpbGU6IHN0cmluZywgYnVpbGRPcHRpb25zOiBCdWlsZE9wdGlvbnMpIHtcbiAgICBjb25zdCBkZWZhdWx0T3B0aW9uczogQnVpbGRPcHRpb25zID0ge1xuICAgICAgICBidW5kbGU6IHRydWUsXG4gICAgICAgIHBsYXRmb3JtOiAnbm9kZScsXG4gICAgICAgIHRhcmdldDogJ25vZGUxOCcsXG4gICAgICAgIG1pbmlmeTogZmFsc2UsXG4gICAgICAgIC8vIGtlZXBOYW1lczogdHJ1ZSwgLy8gS2VlcCB0aGUgbmFtZXMgaW4gdGhlIG1pbmlmaWVkIGNvZGUgZm9yIERJLXRva2Vuc1xuICAgICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICAgIC4uLmJ1aWxkT3B0aW9ucywgLy8gT3ZlcnJpZGUgd2l0aCBzcGVjaWZpYyBidWlsZCBvcHRpb25zXG4gICAgICAgIGV4dGVybmFsOiBbIC4uLihidWlsZE9wdGlvbnMuZXh0ZXJuYWwgfHwgW10pLCBcbiAgICAgICAgICAgIC8vIG1ha2Ugc3VyZSBhbGwgdGhlIGRlcGVuZGVuY2llcyBvZiBjb3JlLWZ3IGxheWVyIGFyZSBtYXJrZWQgYXMgZXh0ZXJuYWxcbiAgICAgICAgICAgICdAdGVuMjRncm91cC9mdzI0JyxcbiAgICAgICAgICAgICdAYXdzLXNkaycsXG4gICAgICAgICAgICAnQHNtaXRoeScsXG4gICAgICAgICAgICAnYXdzLWNkay1saWInLFxuICAgICAgICAgICAgJ2VzYnVpbGQnLFxuICAgICAgICBdLCAvLyBTcGVjaWZ5IGV4dGVybmFsIHBhY2thZ2VzXG4gICAgICAgIG91dGZpbGU6IG91dHB1dEZpbGUsXG4gICAgICAgIGVudHJ5UG9pbnRzOiBbZW50cnlGaWxlXSxcbiAgICB9O1xuXG4gICAgRGVmYXVsdExvZ2dlci5kZWJ1ZyhgYnVuZGxlV2l0aEVzYnVpbGQ6IEJ1bmRsaW5nICR7ZW50cnlGaWxlfSBpbnRvICR7b3V0cHV0RmlsZX0gd2l0aCBvcHRpb25zOmAsIGRlZmF1bHRPcHRpb25zKTtcbiAgICBhd2FpdCBidWlsZChkZWZhdWx0T3B0aW9ucyk7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlcyBoYXNoIG9mIGEgZmlsZSdzIGNvbnRlbnRzXG4gKi9cbmZ1bmN0aW9uIGNhbGN1bGF0ZUZpbGVIYXNoKGZpbGVQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkRmlsZVN5bmMoZmlsZVBhdGgpO1xuICAgIHJldHVybiBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoY29udGVudCkuZGlnZXN0KCdoZXgnKTtcbn1cblxuLyoqXG4gKiBDb21wYXJlIHR3byBkaXJlY3RvcmllcyBhbmQgY2hlY2sgaWYgdGhlaXIgY29udGVudHMgYXJlIGlkZW50aWNhbFxuICovXG5mdW5jdGlvbiBhcmVEaXJlY3Rvcmllc0lkZW50aWNhbChkaXIxOiBzdHJpbmcsIGRpcjI6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGlmICghZXhpc3RzU3luYyhkaXIxKSB8fCAhZXhpc3RzU3luYyhkaXIyKSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZmlsZXMxID0gcmVhZGRpclN5bmMoZGlyMSwgeyByZWN1cnNpdmU6IHRydWUgfSkgYXMgc3RyaW5nW107XG4gICAgICAgIGNvbnN0IGZpbGVzMiA9IHJlYWRkaXJTeW5jKGRpcjIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pIGFzIHN0cmluZ1tdO1xuXG4gICAgICAgIGlmIChmaWxlczEubGVuZ3RoICE9PSBmaWxlczIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgcmV0dXJuIGZpbGVzMS5ldmVyeShmaWxlID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbGUxUGF0aCA9IHBhdGhKb2luKGRpcjEsIGZpbGUpO1xuICAgICAgICAgICAgY29uc3QgZmlsZTJQYXRoID0gcGF0aEpvaW4oZGlyMiwgZmlsZSk7XG5cbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhmaWxlMlBhdGgpKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGNvbnN0IHN0YXQxID0gbHN0YXRTeW5jKGZpbGUxUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBzdGF0MiA9IGxzdGF0U3luYyhmaWxlMlBhdGgpO1xuXG4gICAgICAgICAgICBpZiAoc3RhdDEuaXNEaXJlY3RvcnkoKSAhPT0gc3RhdDIuaXNEaXJlY3RvcnkoKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgaWYgKHN0YXQxLmlzRGlyZWN0b3J5KCkpIHJldHVybiB0cnVlO1xuXG4gICAgICAgICAgICByZXR1cm4gY2FsY3VsYXRlRmlsZUhhc2goZmlsZTFQYXRoKSA9PT0gY2FsY3VsYXRlRmlsZUhhc2goZmlsZTJQYXRoKTtcbiAgICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbn1cblxuLyoqXG4gKiBNb3ZlIGRpcmVjdG9yeSBjb250ZW50cyBmcm9tIHNvdXJjZSB0byB0YXJnZXRcbiAqL1xuZnVuY3Rpb24gbW92ZURpcmVjdG9yeUNvbnRlbnRzKHNvdXJjZURpcjogc3RyaW5nLCB0YXJnZXREaXI6IHN0cmluZykge1xuICAgIGlmICghZXhpc3RzU3luYyh0YXJnZXREaXIpKSB7XG4gICAgICAgIG1rZGlyU3luYyh0YXJnZXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGVzID0gcmVhZGRpclN5bmMoc291cmNlRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KSBhcyBzdHJpbmdbXTtcbiAgICBmaWxlcy5mb3JFYWNoKGZpbGUgPT4ge1xuICAgICAgICBjb25zdCBzb3VyY2VQYXRoID0gcGF0aEpvaW4oc291cmNlRGlyLCBmaWxlKTtcbiAgICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IHBhdGhKb2luKHRhcmdldERpciwgZmlsZSk7XG5cbiAgICAgICAgaWYgKGxzdGF0U3luYyhzb3VyY2VQYXRoKS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmModGFyZ2V0UGF0aCkpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmModGFyZ2V0UGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAoZXhpc3RzU3luYyh0YXJnZXRQYXRoKSkge1xuICAgICAgICAgICAgICAgIHJtU3luYyh0YXJnZXRQYXRoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlbmFtZVN5bmMoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCk7XG4gICAgICAgIH1cbiAgICB9KTtcbn1cblxuLyoqXG4gKiBDbGVhbnMgdXAgYSB0ZW1wb3JhcnkgZGlyZWN0b3J5IGJ5IHJlbW92aW5nIGFsbCBmaWxlcyBhbmQgc3ViZGlyZWN0b3JpZXMuXG4gKiBAcGFyYW0gZGlyZWN0b3J5IC0gVGhlIGRpcmVjdG9yeSB0byBjbGVhbiB1cC5cbiAqL1xuZnVuY3Rpb24gY2xlYW51cERpcmVjdG9yeShkaXJlY3Rvcnk6IHN0cmluZykge1xuICAgIHRyeSB7XG4gICAgICAgIHJtU3luYyhkaXJlY3RvcnksIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBidW5kbGVXaXRoRXNidWlsZDogQ2xlYW5lZCB1cCB0ZW1wb3JhcnkgZGlyZWN0b3J5OiAke2RpcmVjdG9yeX1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmVycm9yKGBidW5kbGVXaXRoRXNidWlsZDogRmFpbGVkIHRvIGNsZWFuIHVwIGRpcmVjdG9yeSAke2RpcmVjdG9yeX06YCwgZXJyb3IpO1xuICAgIH1cbn1cbiJdfQ==