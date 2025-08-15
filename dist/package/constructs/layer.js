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
     *
     * @example
     * ```ts
     * // Detailed usage example.
     * const layerConfig: ILayerConstructConfig[] = [
     *   {
     *     layerName: "MyLayer",
     *     sourcePath: "/path/to/source",
     *     clearOutputDir: true,
     *     layerProps: {
     *       // additional layer properties
     *     }
     *   }, {
     *      sourcePath: "/path/to/layer/file.ts", // File needs to be decorated with `@LayerEntry`
     *      mode: 'BUILD_AND_PACKAGE',
     *  }, {
     *     sourcePath: "/path/to/layers/", // only the files decorated with `@LayerEntry({...})` will be processed as layers
     *     mode: 'BUILD_AND_PACKAGE',
     *     outputDir: "/path/to/dist"
     *     clearOutputDir: true, // defaults to false
     * }
     * ];
     * const layer = new LayerConstruct(layerConfig);
     * ```
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
            // collect global entry-packages for lambdas
            this.fw24.addGlobalLambdaEntryPackage(`env:layerImportPath:${layerName}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGF5ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9sYXllci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFpVkEsc0NBRUM7QUFqVkQsMkNBQXdDO0FBQ3hDLHVDQUFvQztBQUNwQyx1REFBeUY7QUFDekYsd0NBQXNFO0FBQ3RFLHVEQUFzRztBQUN0RywrQkFBa0g7QUFDbEgsMkJBQTZIO0FBQzdILHFDQUE4QztBQUM5Qyw4Q0FBMkM7QUFFM0MsbUNBQW9DO0FBdUVwQzs7R0FFRztBQUNILE1BQWEsY0FBYztJQXNDSDtJQXJDWCxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxDQUFDO0lBQ3RDLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUM7SUFDM0IsWUFBWSxHQUFhLEVBQUUsQ0FBQztJQUM1QixNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUVsQjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O09BMkJHO0lBQ0gsWUFBb0IsTUFBK0I7UUFBL0IsV0FBTSxHQUFOLE1BQU0sQ0FBeUI7UUFFL0MsZUFBZTtRQUNmLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxXQUFXLEVBQUUsRUFBRTtZQUMzQixXQUFXLENBQUMsSUFBSSxHQUFHLFdBQVcsQ0FBQyxJQUFJLElBQUksbUJBQW1CLENBQUM7WUFDM0QsSUFBSSxXQUFXLENBQUMsSUFBSSxLQUFLLG1CQUFtQixFQUFFLENBQUM7Z0JBQzNDLFdBQVcsQ0FBQyxjQUFjLEdBQUcsV0FBVyxDQUFDLGNBQWMsSUFBSSxLQUFLLENBQUM7WUFDckUsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsZUFBTSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUUsT0FBTyxDQUFDLENBQUM7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LEVBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztnQkFDMUIsSUFBQSxjQUFTLEVBQUMsVUFBVSxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7WUFDL0MsQ0FBQztRQUNMLENBQUM7YUFBTSxDQUFDO1lBQ0osSUFBSSxJQUFBLGVBQVUsRUFBQyxVQUFVLENBQUMsRUFBRSxDQUFDO2dCQUN6QixJQUFBLFdBQU0sRUFBQyxVQUFVLENBQUMsQ0FBQztZQUN2QixDQUFDO1lBQ0QsSUFBQSxlQUFVLEVBQUMsVUFBVSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFTLGdCQUFnQixDQUFDLFNBQWlCO0lBQ3ZDLElBQUksQ0FBQztRQUNELElBQUEsV0FBTSxFQUFDLFNBQVMsRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFDcEQsdUJBQWEsQ0FBQyxJQUFJLENBQUMsc0RBQXNELFNBQVMsRUFBRSxDQUFDLENBQUM7SUFDMUYsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDYix1QkFBYSxDQUFDLEtBQUssQ0FBQyxtREFBbUQsU0FBUyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDaEcsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDZm5PdXRwdXQsIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5cbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuLi9jb3JlL2hlbHBlclwiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IERlZmF1bHRMb2dnZXIsIExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgQXJjaGl0ZWN0dXJlLCBDb2RlLCBMYXllclZlcnNpb24sIExheWVyVmVyc2lvblByb3BzLCBSdW50aW1lIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBiYXNlbmFtZSBhcyBwYXRoQmFzZU5hbWUsIHJlc29sdmUgYXMgcGF0aFJlc29sdmUsIGpvaW4gYXMgcGF0aEpvaW4sIGV4dG5hbWUgYXMgcGF0aEV4dG5hbWUgfSBmcm9tICdwYXRoJztcbmltcG9ydCB7IGV4aXN0c1N5bmMsIG1rZGlyU3luYywgcmVhZGRpclN5bmMsIHN0YXRTeW5jLCBybVN5bmMsIGxzdGF0U3luYywgY29weUZpbGVTeW5jLCByZW5hbWVTeW5jLCByZWFkRmlsZVN5bmMgfSBmcm9tICdmcyc7XG5pbXBvcnQgeyBidWlsZCwgQnVpbGRPcHRpb25zIH0gZnJvbSAnZXNidWlsZCc7XG5pbXBvcnQgeyBMYXllckVudHJ5IH0gZnJvbSBcIi4uL2RlY29yYXRvcnNcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSBcImNyeXB0b1wiO1xuXG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIFBBQ0tBR0VfRElSRUNUT1JZIG1vZGUuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVBhY2thZ2VEaXJlY3RvcnlDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgbmFtZSBvZiB0aGUgbGF5ZXIuXG4gICAgICovXG4gICAgbGF5ZXJOYW1lOiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgc291cmNlIHBhdGggb2YgdGhlIGxheWVyIGRpcmVjdG9yeS5cbiAgICAgKi9cbiAgICBzb3VyY2VQYXRoOiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgbW9kZSBvZiBwYWNrYWdpbmc6IHBhY2thZ2UgdGhlIHdob2xlIGRpcmVjdG9yeS5cbiAgICAgKi9cbiAgICBtb2RlPzogJ1BBQ0tBR0VfRElSRUNUT1JZJztcblxuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIHByb3BlcnRpZXMgZm9yIHRoZSBsYXllciB2ZXJzaW9uLlxuICAgICAqL1xuICAgIGxheWVyUHJvcHM/OiBPbWl0PExheWVyVmVyc2lvblByb3BzLCAnY29kZSc+O1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIHRoZSBCVUlMRF9BTkRfUEFDS0FHRSBtb2RlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElCdWlsZEFuZFBhY2thZ2VDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgc291cmNlIHBhdGggb2YgdGhlIGxheWVyLCB3aGljaCBjYW4gYmUgYSBkaXJlY3Rvcnkgb3IgYSBmaWxlLlxuICAgICAqL1xuICAgIHNvdXJjZVBhdGg6IHN0cmluZztcbiAgICBcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBwcm9wZXJ0aWVzIGZvciB0aGUgbGF5ZXIgdmVyc2lvbi5cbiAgICAgKi9cbiAgICBsYXllclByb3BzPzogT21pdDxMYXllclZlcnNpb25Qcm9wcywgJ2NvZGUnPjtcblxuICAgIC8qKlxuICAgICAqIFRoZSBtb2RlIG9mIHBhY2thZ2luZzogc2NhbiBhbmQgYnVpbGQgaW5kaXZpZHVhbCBmaWxlcy5cbiAgICAgKi9cbiAgICBtb2RlOiAnQlVJTERfQU5EX1BBQ0tBR0UnO1xuXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgY3VzdG9tIGRpc3RyaWJ1dGlvbiBkaXJlY3RvcnkgZm9yIHRoZSBidWlsZCBvdXRwdXRzLlxuICAgICAqL1xuICAgIGRpc3REaXJlY3Rvcnk/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBGbGFnIHRvIGNsZWFyIHRoZSBvdXRwdXQgZGlyZWN0b3J5IGFmdGVyIHBhY2thZ2luZzsgZGVmYXVsdHMgdG8gZmFsc2UuXG4gICAgICovXG4gICAgY2xlYXJPdXRwdXREaXI/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogQ29uZmlndXJhYmxlIG91dHB1dCBwYXRoIGZvciB0aGUgcGFja2FnZS5cbiAgICAgKi8gXG4gICAgcGFja2FnZVBhdGg/OiBzdHJpbmc7XG5cbiAgICBcbiAgICBub3RHbG9iYWw/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIGxheWVyIGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IHR5cGUgSUxheWVyQ29uc3RydWN0Q29uZmlnID0gSVBhY2thZ2VEaXJlY3RvcnlDb25maWcgfCBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBjb25zdHJ1Y3QgZm9yIGNyZWF0aW5nIExhbWJkYSBsYXllcnMuXG4gKi9cbmV4cG9ydCBjbGFzcyBMYXllckNvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihMYXllckNvbnN0cnVjdCk7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICBcbiAgICBuYW1lID0gTGF5ZXJDb25zdHJ1Y3QubmFtZTtcbiAgICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gW107XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBMYXllckNvbnN0cnVjdCBpbnN0YW5jZS5cbiAgICAgKiBAcGFyYW0gY29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBMYXllckNvbnN0cnVjdC5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHRzXG4gICAgICogLy8gRGV0YWlsZWQgdXNhZ2UgZXhhbXBsZS5cbiAgICAgKiBjb25zdCBsYXllckNvbmZpZzogSUxheWVyQ29uc3RydWN0Q29uZmlnW10gPSBbXG4gICAgICogICB7XG4gICAgICogICAgIGxheWVyTmFtZTogXCJNeUxheWVyXCIsXG4gICAgICogICAgIHNvdXJjZVBhdGg6IFwiL3BhdGgvdG8vc291cmNlXCIsXG4gICAgICogICAgIGNsZWFyT3V0cHV0RGlyOiB0cnVlLFxuICAgICAqICAgICBsYXllclByb3BzOiB7XG4gICAgICogICAgICAgLy8gYWRkaXRpb25hbCBsYXllciBwcm9wZXJ0aWVzXG4gICAgICogICAgIH1cbiAgICAgKiAgIH0sIHtcbiAgICAgKiAgICAgIHNvdXJjZVBhdGg6IFwiL3BhdGgvdG8vbGF5ZXIvZmlsZS50c1wiLCAvLyBGaWxlIG5lZWRzIHRvIGJlIGRlY29yYXRlZCB3aXRoIGBATGF5ZXJFbnRyeWBcbiAgICAgKiAgICAgIG1vZGU6ICdCVUlMRF9BTkRfUEFDS0FHRScsXG4gICAgICogIH0sIHtcbiAgICAgKiAgICAgc291cmNlUGF0aDogXCIvcGF0aC90by9sYXllcnMvXCIsIC8vIG9ubHkgdGhlIGZpbGVzIGRlY29yYXRlZCB3aXRoIGBATGF5ZXJFbnRyeSh7Li4ufSlgIHdpbGwgYmUgcHJvY2Vzc2VkIGFzIGxheWVyc1xuICAgICAqICAgICBtb2RlOiAnQlVJTERfQU5EX1BBQ0tBR0UnLFxuICAgICAqICAgICBvdXRwdXREaXI6IFwiL3BhdGgvdG8vZGlzdFwiXG4gICAgICogICAgIGNsZWFyT3V0cHV0RGlyOiB0cnVlLCAvLyBkZWZhdWx0cyB0byBmYWxzZVxuICAgICAqIH1cbiAgICAgKiBdO1xuICAgICAqIGNvbnN0IGxheWVyID0gbmV3IExheWVyQ29uc3RydWN0KGxheWVyQ29uZmlnKTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIGNvbmZpZzogSUxheWVyQ29uc3RydWN0Q29uZmlnW10pIHtcbiAgICAgICAgXG4gICAgICAgIC8vIGFkZCBkZWZhdWx0c1xuICAgICAgICBjb25maWcuZm9yRWFjaCgobGF5ZXJDb25maWcpID0+IHtcbiAgICAgICAgICAgIGxheWVyQ29uZmlnLm1vZGUgPSBsYXllckNvbmZpZy5tb2RlIHx8ICdQQUNLQUdFX0RJUkVDVE9SWSc7XG4gICAgICAgICAgICBpZiAobGF5ZXJDb25maWcubW9kZSA9PT0gJ0JVSUxEX0FORF9QQUNLQUdFJykge1xuICAgICAgICAgICAgICAgIGxheWVyQ29uZmlnLmNsZWFyT3V0cHV0RGlyID0gbGF5ZXJDb25maWcuY2xlYXJPdXRwdXREaXIgPz8gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKGNvbmZpZywgJ0xBWUVSJyk7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbCh0aGlzLmNvbmZpZy5tYXAoYXN5bmMgKGxheWVyQ29uZmlnKSA9PiB7XG4gICAgICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayhsYXllckNvbmZpZy5zdGFja05hbWUgfHwgdGhpcy5mdzI0LmdldENvbmZpZygpLmxheWVyU3RhY2tOYW1lLCBsYXllckNvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlByb2Nlc3NpbmcgbGF5ZXI6XCIsIGxheWVyQ29uZmlnKTtcblxuICAgICAgICAgICAgaWYgKGxheWVyQ29uZmlnLm1vZGUgPT09ICdQQUNLQUdFX0RJUkVDVE9SWScpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBhY2thZ2VEaXJlY3RvcnkobGF5ZXJDb25maWcpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllckNvbmZpZy5tb2RlID09PSAnQlVJTERfQU5EX1BBQ0tBR0UnKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zY2FuQW5kUGFja2FnZUZpbGVzKGxheWVyQ29uZmlnKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIG1vZGUgZm9yIGxheWVyICR7bGF5ZXJDb25maWd9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQYWNrYWdlcyBhIGRpcmVjdG9yeSBhcyBhIExhbWJkYSBsYXllci5cbiAgICAgKiBAcGFyYW0gbGF5ZXJDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIGxheWVyLlxuICAgICAqIEBwYXJhbSBtYWluU3RhY2sgLSBUaGUgbWFpbiBzdGFjayBmb3IgZGVwbG95aW5nIHJlc291cmNlcy5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHBhY2thZ2VEaXJlY3RvcnkobGF5ZXJDb25maWc6IElQYWNrYWdlRGlyZWN0b3J5Q29uZmlnKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRMYXllclByb3BzOiBMYXllclZlcnNpb25Qcm9wcyA9IHtcbiAgICAgICAgICAgIGxheWVyVmVyc2lvbk5hbWU6IGxheWVyQ29uZmlnLmxheWVyTmFtZSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVSdW50aW1lczogWyBSdW50aW1lLk5PREVKU18yMl9YIF0sXG4gICAgICAgICAgICBjb2RlOiBDb2RlLmZyb21Bc3NldChsYXllckNvbmZpZy5zb3VyY2VQYXRoKSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVBcmNoaXRlY3R1cmVzOiBbQXJjaGl0ZWN0dXJlLkFSTV82NF0sXG4gICAgICAgIH07XG4gICAgICAgIFxuICAgICAgICBjb25zdCBsYXllciA9IG5ldyBMYXllclZlcnNpb24odGhpcy5tYWluU3RhY2ssIGxheWVyQ29uZmlnLmxheWVyTmFtZSArICctbGF5ZXInLCB7XG4gICAgICAgICAgICAuLi5kZWZhdWx0TGF5ZXJQcm9wcyxcbiAgICAgICAgICAgIC4uLmxheWVyQ29uZmlnLmxheWVyUHJvcHMsXG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBsYXllckNvbmZpZy5sYXllck5hbWUsIGxheWVyLCBPdXRwdXRUeXBlLkxBWUVSLCAnbGF5ZXJWZXJzaW9uQXJuJyk7XG5cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTY2FucyBhIGRpcmVjdG9yeSBmb3IgVHlwZVNjcmlwdCBmaWxlcyBhbmQgY3JlYXRlcyBMYW1iZGEgbGF5ZXJzIGZvciB0aGVtLlxuICAgICAqIEBwYXJhbSBsYXllckNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgbGF5ZXIuXG4gICAgICogQHBhcmFtIG1haW5TdGFjayAtIFRoZSBtYWluIHN0YWNrIGZvciBkZXBsb3lpbmcgcmVzb3VyY2VzLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgc2NhbkFuZFBhY2thZ2VGaWxlcyhsYXllckNvbmZpZzogSUJ1aWxkQW5kUGFja2FnZUNvbmZpZykge1xuICAgICAgICBjb25zdCBkaXN0RGlyZWN0b3J5ID0gbGF5ZXJDb25maWcuZGlzdERpcmVjdG9yeSB8fCBwYXRoSm9pbihfX2Rpcm5hbWUsICcuLi8uLi9kaXN0Jyk7XG4gICAgICAgIGNvbnN0IHNvdXJjZURpcmVjdG9yeU9yRmlsZU5hbWUgPSBwYXRoUmVzb2x2ZShsYXllckNvbmZpZy5zb3VyY2VQYXRoKTtcbiAgICAgICAgY29uc3QgdHNGaWxlcyA9IGxzdGF0U3luYyhzb3VyY2VEaXJlY3RvcnlPckZpbGVOYW1lKS5pc0RpcmVjdG9yeSgpXG4gICAgICAgICAgICA/IHNjYW5EaXJlY3Rvcnkoc291cmNlRGlyZWN0b3J5T3JGaWxlTmFtZSlcbiAgICAgICAgICAgIDogW3NvdXJjZURpcmVjdG9yeU9yRmlsZU5hbWVdO1xuXG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHRzRmlsZXMubWFwKGFzeW5jIChmaWxlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnRyeUNyZWF0ZUxheWVyRm9yRmlsZShmaWxlLCBkaXN0RGlyZWN0b3J5LCBsYXllckNvbmZpZyk7XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBBdHRlbXB0cyB0byBjcmVhdGUgYSBMYW1iZGEgbGF5ZXIgZm9yIGEgZ2l2ZW4gVHlwZVNjcmlwdCBmaWxlLlxuICAgICAqIEBwYXJhbSBmaWxlIC0gVGhlIHBhdGggdG8gdGhlIFR5cGVTY3JpcHQgZmlsZS5cbiAgICAgKiBAcGFyYW0gZGlzdERpcmVjdG9yeSAtIFRoZSBvdXRwdXQgZGlyZWN0b3J5IGZvciB0aGUgYnVpbGQuXG4gICAgICogQHBhcmFtIG1haW5TdGFjayAtIFRoZSBtYWluIHN0YWNrIGZvciBkZXBsb3lpbmcgcmVzb3VyY2VzLlxuICAgICAqIEBwYXJhbSBsYXllckNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgbGF5ZXIuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyB0cnlDcmVhdGVMYXllckZvckZpbGUoZmlsZTogc3RyaW5nLCBkaXN0RGlyZWN0b3J5OiBzdHJpbmcsIGxheWVyQ29uZmlnOiBJQnVpbGRBbmRQYWNrYWdlQ29uZmlnKSB7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBtb2R1bGVFeHBvcnRzID0gYXdhaXQgaW1wb3J0KGZpbGUpO1xuXG4gICAgICAgIGNvbnN0IGZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSA9IE9iamVjdC5rZXlzKG1vZHVsZUV4cG9ydHMpLmZpbmQoKGtleSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZXhwb3J0ZWQgPSBtb2R1bGVFeHBvcnRzW2tleV07XG4gICAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydGVkID09PSAnZnVuY3Rpb24nICYmIGlzTGF5ZXJFbnRyeShleHBvcnRlZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhwb3J0ZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICBcbiAgICAgICAgaWYoIWZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZSl7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBMYXllckVudHJ5IGZvdW5kIGluIGZpbGUgJHtmaWxlfS4gV2lsbCB1c2UgRGVmYXVsdCBvcHRpb25zLmApO1xuICAgICAgICB9XG5cbiAgICAgICAgTGF5ZXJFbnRyeSh7IG5vdEdsb2JhbDogbGF5ZXJDb25maWcubm90R2xvYmFsID8/IGZhbHNlIH0pXG4gICAgICAgIGNsYXNzIEVtcHR5TGF5ZXJEZXNjcmlwdG9yIHt9XG5cbiAgICAgICAgLy8gaWYgbm8gbGF5ZXIgZGVzY3JpcHRvciBmb3VuZCBpbiB0aGUgZmlsZSwgY3JlYXRlIGFuIGVtcHR5IGNsYXNzIHdoaWNoIHdpbGwgdXNlIGRlZmF1bHQgb3B0aW9uc1xuICAgICAgICBjb25zdCBsYXllckRlc2NyaXB0b3IgPSBmb3VuZExheWVyRGVzY3JpcHRvck5hbWUgPyBtb2R1bGVFeHBvcnRzW2ZvdW5kTGF5ZXJEZXNjcmlwdG9yTmFtZV0gOiBFbXB0eUxheWVyRGVzY3JpcHRvcjtcblxuICAgICAgICBjb25zdCBidWlsZE9wdGlvbnMgPSBnZXRMYXllckJ1aWxkT3B0aW9ucyhsYXllckRlc2NyaXB0b3IpIHx8IHt9O1xuXG4gICAgICAgIGNvbnN0IGZpbGVCYXNlTmFtZSA9IHBhdGhCYXNlTmFtZShmaWxlLCBwYXRoRXh0bmFtZShmaWxlKSk7XG4gICAgICAgIGNvbnN0IGxheWVyTmFtZSA9IGdldExheWVyTmFtZShsYXllckRlc2NyaXB0b3IpIHx8IGZpbGVCYXNlTmFtZTtcbiAgICAgICAgY29uc3QgY29uZmlndXJlZE91dHB1dFBhdGggPSBgbm9kZWpzL25vZGVfbW9kdWxlcy8ke2xheWVyQ29uZmlnLnBhY2thZ2VQYXRoID8/ICcnfWAgO1xuICAgIFxuICAgICAgICBjb25zdCBvdXRwdXREaXIgPSBwYXRoSm9pbihkaXN0RGlyZWN0b3J5LCBsYXllck5hbWUsIGNvbmZpZ3VyZWRPdXRwdXRQYXRoLCBmaWxlQmFzZU5hbWUpO1xuICAgICAgICBjb25zdCBidW5kbGVEaXIgPSBwYXRoSm9pbihkaXN0RGlyZWN0b3J5LCBsYXllck5hbWUpO1xuXG4gICAgICAgIGNvbnN0IHRlbXBEaXIgPSBwYXRoSm9pbihkaXN0RGlyZWN0b3J5LCAnbGF5ZXJzX3RlbXAnLCBsYXllck5hbWUpO1xuICAgICAgICBjb25zdCB0ZW1wT3V0cHV0RGlyID0gcGF0aEpvaW4odGVtcERpciwgY29uZmlndXJlZE91dHB1dFBhdGgsIGZpbGVCYXNlTmFtZSk7XG4gICAgICAgIGNvbnN0IHRlbXBPdXRwdXRGaWxlID0gcGF0aEpvaW4odGVtcE91dHB1dERpciwgJ2luZGV4LmpzJyk7XG5cbiAgICAgICAgLy8gRW5zdXJlIHRlbXAgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmModGVtcE91dHB1dERpcikpIHtcbiAgICAgICAgICAgIG1rZGlyU3luYyh0ZW1wT3V0cHV0RGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEJ1aWxkIHRvIHRlbXBvcmFyeSBkaXJlY3RvcnkgZmlyc3RcbiAgICAgICAgYXdhaXQgYnVuZGxlV2l0aEVzYnVpbGQoZmlsZSwgdGVtcE91dHB1dEZpbGUsIGJ1aWxkT3B0aW9ucyk7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgb3V0cHV0IGRpcmVjdG9yeSBleGlzdHMgYW5kIGNvbXBhcmUgY29udGVudHNcbiAgICAgICAgY29uc3Qgc2hvdWxkVXBkYXRlT3V0cHV0ID0gIWV4aXN0c1N5bmMob3V0cHV0RGlyKSB8fCAhYXJlRGlyZWN0b3JpZXNJZGVudGljYWwodGVtcE91dHB1dERpciwgb3V0cHV0RGlyKTtcblxuICAgICAgICBpZiAoc2hvdWxkVXBkYXRlT3V0cHV0KSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDb250ZW50IGNoYW5nZWQgZm9yIGxheWVyICR7bGF5ZXJOYW1lfSwgdXBkYXRpbmcgb3V0cHV0YCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENsZWFuIGV4aXN0aW5nIG91dHB1dCBpZiBpdCBleGlzdHNcbiAgICAgICAgICAgIGlmIChleGlzdHNTeW5jKG91dHB1dERpcikpIHtcbiAgICAgICAgICAgICAgICBybVN5bmMob3V0cHV0RGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gTW92ZSBjb250ZW50cyBmcm9tIHRlbXAgdG8gb3V0cHV0XG4gICAgICAgICAgICBtb3ZlRGlyZWN0b3J5Q29udGVudHModGVtcE91dHB1dERpciwgb3V0cHV0RGlyKTtcblxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gY2hhbmdlcyBkZXRlY3RlZCBmb3IgbGF5ZXIgJHtsYXllck5hbWV9LCBrZWVwaW5nIGV4aXN0aW5nIGNvZGVgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHRoaXMgaXMgdGhlIHBhdGggdGhhdCB3aWxsIGJlIHVzZWQgaW4gdGhlIGxheWVyIGltcG9ydCBzdGF0ZW1lbnRcbiAgICAgICAgY29uc3QgbGF5ZXJJbXBvcnRQYXRoID0gcGF0aEpvaW4oJy9vcHQnLCBjb25maWd1cmVkT3V0cHV0UGF0aCwgZmlsZUJhc2VOYW1lLCAnaW5kZXguanMnKTtcbiAgICAgICAgLy8gcHV0IGl0IGludG8gZncyNCdzIGNvbmZpZyBzbyBpdCBjYW4gYmUgYWRkZWQgdG8gdGhlIGxhbWJkYSdzIGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdsYXllckltcG9ydFBhdGgnLCBsYXllckltcG9ydFBhdGgpO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGxheWVyTmFtZSwgbGF5ZXJJbXBvcnRQYXRoLCAnbGF5ZXJJbXBvcnRQYXRoJyk7XG5cbiAgICAgICAgaWYoaXNHbG9iYWxMYXllcihsYXllckRlc2NyaXB0b3IpKXtcbiAgICAgICAgICAgIC8vIGNvbGxlY3QgZ2xvYmFsIGxheWVycyBmb3IgbGFtYmRhXG4gICAgICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsTGFtYmRhTGF5ZXJOYW1lcyhsYXllck5hbWUpO1xuICAgICAgICAgICAgLy8gY29sbGVjdCBnbG9iYWwgZW50cnktcGFja2FnZXMgZm9yIGxhbWJkYXNcbiAgICAgICAgICAgIHRoaXMuZncyNC5hZGRHbG9iYWxMYW1iZGFFbnRyeVBhY2thZ2UoYGVudjpsYXllckltcG9ydFBhdGg6JHtsYXllck5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYXllclByb3BzID0gZ2V0TGF5ZXJQcm9wcyhsYXllckRlc2NyaXB0b3IpO1xuXG4gICAgICAgIGNvbnN0IGRlZmF1bHRMYXllclByb3BzOiBMYXllclZlcnNpb25Qcm9wcyA9IHtcbiAgICAgICAgICAgIGxheWVyVmVyc2lvbk5hbWU6IGxheWVyTmFtZSxcbiAgICAgICAgICAgIGNvbXBhdGlibGVSdW50aW1lczogWyBSdW50aW1lLk5PREVKU18yMl9YIF0sXG4gICAgICAgICAgICBjb2RlOiBDb2RlLmZyb21Bc3NldChidW5kbGVEaXIpLFxuICAgICAgICAgICAgY29tcGF0aWJsZUFyY2hpdGVjdHVyZXM6IFtBcmNoaXRlY3R1cmUuQVJNXzY0XSxcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBsYXllciA9IG5ldyBMYXllclZlcnNpb24odGhpcy5tYWluU3RhY2ssIGxheWVyTmFtZSArICctbGF5ZXInLCB7XG4gICAgICAgICAgICAuLi5kZWZhdWx0TGF5ZXJQcm9wcyxcbiAgICAgICAgICAgIC4uLmxheWVyQ29uZmlnLmxheWVyUHJvcHMsXG4gICAgICAgICAgICAuLi5sYXllclByb3BzLCAvLyB0aGUgbGF5ZXJQcm9wcyBmcm9tIHRoZSBkZWNvcmF0b3IgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgbGF5ZXJOYW1lLCBsYXllciwgT3V0cHV0VHlwZS5MQVlFUiwgJ2xheWVyVmVyc2lvbkFybicpO1xuXG4gICAgICAgIC8vIENsZWFuIHVwIHRoZSB0ZW1wb3Jhcnkgb3V0cHV0IGRpcmVjdG9yeSBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmIChsYXllckNvbmZpZy5jbGVhck91dHB1dERpcikge1xuICAgICAgICAgICAgY2xlYW51cERpcmVjdG9yeShvdXRwdXREaXIpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IHNjYW5zIGEgZGlyZWN0b3J5IGFuZCByZXR1cm5zIGEgbGlzdCBvZiBUeXBlU2NyaXB0IGZpbGVzLlxuICogQHBhcmFtIGRpcmVjdG9yeSAtIFRoZSBkaXJlY3RvcnkgdG8gc2Nhbi5cbiAqIEByZXR1cm5zIEFuIGFycmF5IG9mIFR5cGVTY3JpcHQgZmlsZSBwYXRocy5cbiAqL1xuZnVuY3Rpb24gc2NhbkRpcmVjdG9yeShkaXJlY3Rvcnk6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBsZXQgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgaXRlbXMgPSByZWFkZGlyU3luYyhkaXJlY3RvcnkpO1xuXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gcGF0aEpvaW4oZGlyZWN0b3J5LCBpdGVtKTtcbiAgICAgICAgY29uc3Qgc3RhdCA9IHN0YXRTeW5jKGZ1bGxQYXRoKTtcblxuICAgICAgICBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBmaWxlcyA9IGZpbGVzLmNvbmNhdChzY2FuRGlyZWN0b3J5KGZ1bGxQYXRoKSk7XG4gICAgICAgIH0gZWxzZSBpZiAoc3RhdC5pc0ZpbGUoKSAmJiBmdWxsUGF0aC5lbmRzV2l0aCgnLnRzJykpIHtcbiAgICAgICAgICAgIGZpbGVzLnB1c2goZnVsbFBhdGgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbGVzO1xufVxuXG5mdW5jdGlvbiBpc0xheWVyRW50cnkodGFyZ2V0OiBGdW5jdGlvbik6IGJvb2xlYW4ge1xuICAgIHJldHVybiAhIWdldExheWVyTmFtZSh0YXJnZXQpO1xufVxuXG5mdW5jdGlvbiBpc0dsb2JhbExheWVyKHRhcmdldDogRnVuY3Rpb24pOiBib29sZWFuIHtcbiAgICByZXR1cm4gIVJlZmxlY3QuZ2V0KHRhcmdldCwgJ25vdEdsb2JhbCcpO1xufVxuXG5mdW5jdGlvbiBnZXRMYXllck5hbWUodGFyZ2V0OiBGdW5jdGlvbikge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsICdsYXllck5hbWUnKTtcbn1cblxuZnVuY3Rpb24gZ2V0TGF5ZXJCdWlsZE9wdGlvbnModGFyZ2V0OiBGdW5jdGlvbik6IEJ1aWxkT3B0aW9ucyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRhcmdldCwgJ2J1aWxkT3B0aW9ucycpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGF5ZXJQcm9wcyh0YXJnZXQ6IEZ1bmN0aW9uKTogTGF5ZXJWZXJzaW9uUHJvcHMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsICdsYXllclByb3BzJyk7XG59XG5cbi8qKlxuICogQnVuZGxlcyBhIFR5cGVTY3JpcHQgZmlsZSB1c2luZyBlc2J1aWxkIHdpdGggdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBAcGFyYW0gZW50cnlGaWxlIC0gVGhlIGVudHJ5IGZpbGUgdG8gYnVuZGxlLlxuICogQHBhcmFtIG91dHB1dEZpbGUgLSBUaGUgb3V0cHV0IGZpbGUgcGF0aCBmb3IgdGhlIGJ1bmRsZS5cbiAqIEBwYXJhbSBidWlsZE9wdGlvbnMgLSBUaGUgYnVpbGQgb3B0aW9ucyBmb3IgZXNidWlsZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gYnVuZGxlV2l0aEVzYnVpbGQoZW50cnlGaWxlOiBzdHJpbmcsIG91dHB1dEZpbGU6IHN0cmluZywgYnVpbGRPcHRpb25zOiBCdWlsZE9wdGlvbnMpIHtcbiAgICBjb25zdCBkZWZhdWx0T3B0aW9uczogQnVpbGRPcHRpb25zID0ge1xuICAgICAgICBidW5kbGU6IHRydWUsXG4gICAgICAgIHBsYXRmb3JtOiAnbm9kZScsXG4gICAgICAgIHRhcmdldDogJ25vZGUxOCcsXG4gICAgICAgIG1pbmlmeTogZmFsc2UsXG4gICAgICAgIC8vIGtlZXBOYW1lczogdHJ1ZSwgLy8gS2VlcCB0aGUgbmFtZXMgaW4gdGhlIG1pbmlmaWVkIGNvZGUgZm9yIERJLXRva2Vuc1xuICAgICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICAgIC4uLmJ1aWxkT3B0aW9ucywgLy8gT3ZlcnJpZGUgd2l0aCBzcGVjaWZpYyBidWlsZCBvcHRpb25zXG4gICAgICAgIGV4dGVybmFsOiBbIC4uLihidWlsZE9wdGlvbnMuZXh0ZXJuYWwgfHwgW10pLCBcbiAgICAgICAgICAgIC8vIG1ha2Ugc3VyZSBhbGwgdGhlIGRlcGVuZGVuY2llcyBvZiBjb3JlLWZ3IGxheWVyIGFyZSBtYXJrZWQgYXMgZXh0ZXJuYWxcbiAgICAgICAgICAgICdAdGVuMjRncm91cC9mdzI0JyxcbiAgICAgICAgICAgICdAYXdzLXNkaycsXG4gICAgICAgICAgICAnQHNtaXRoeScsXG4gICAgICAgICAgICAnYXdzLWNkay1saWInLFxuICAgICAgICAgICAgJ2VzYnVpbGQnLFxuICAgICAgICBdLCAvLyBTcGVjaWZ5IGV4dGVybmFsIHBhY2thZ2VzXG4gICAgICAgIG91dGZpbGU6IG91dHB1dEZpbGUsXG4gICAgICAgIGVudHJ5UG9pbnRzOiBbZW50cnlGaWxlXSxcbiAgICB9O1xuXG4gICAgRGVmYXVsdExvZ2dlci5kZWJ1ZyhgYnVuZGxlV2l0aEVzYnVpbGQ6IEJ1bmRsaW5nICR7ZW50cnlGaWxlfSBpbnRvICR7b3V0cHV0RmlsZX0gd2l0aCBvcHRpb25zOmAsIGRlZmF1bHRPcHRpb25zKTtcbiAgICBhd2FpdCBidWlsZChkZWZhdWx0T3B0aW9ucyk7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlcyBoYXNoIG9mIGEgZmlsZSdzIGNvbnRlbnRzXG4gKi9cbmZ1bmN0aW9uIGNhbGN1bGF0ZUZpbGVIYXNoKGZpbGVQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkRmlsZVN5bmMoZmlsZVBhdGgpO1xuICAgIHJldHVybiBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoY29udGVudCkuZGlnZXN0KCdoZXgnKTtcbn1cblxuLyoqXG4gKiBDb21wYXJlIHR3byBkaXJlY3RvcmllcyBhbmQgY2hlY2sgaWYgdGhlaXIgY29udGVudHMgYXJlIGlkZW50aWNhbFxuICovXG5mdW5jdGlvbiBhcmVEaXJlY3Rvcmllc0lkZW50aWNhbChkaXIxOiBzdHJpbmcsIGRpcjI6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGlmICghZXhpc3RzU3luYyhkaXIxKSB8fCAhZXhpc3RzU3luYyhkaXIyKSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZmlsZXMxID0gcmVhZGRpclN5bmMoZGlyMSwgeyByZWN1cnNpdmU6IHRydWUgfSkgYXMgc3RyaW5nW107XG4gICAgICAgIGNvbnN0IGZpbGVzMiA9IHJlYWRkaXJTeW5jKGRpcjIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pIGFzIHN0cmluZ1tdO1xuXG4gICAgICAgIGlmIChmaWxlczEubGVuZ3RoICE9PSBmaWxlczIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgcmV0dXJuIGZpbGVzMS5ldmVyeShmaWxlID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbGUxUGF0aCA9IHBhdGhKb2luKGRpcjEsIGZpbGUpO1xuICAgICAgICAgICAgY29uc3QgZmlsZTJQYXRoID0gcGF0aEpvaW4oZGlyMiwgZmlsZSk7XG5cbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhmaWxlMlBhdGgpKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGNvbnN0IHN0YXQxID0gbHN0YXRTeW5jKGZpbGUxUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBzdGF0MiA9IGxzdGF0U3luYyhmaWxlMlBhdGgpO1xuXG4gICAgICAgICAgICBpZiAoc3RhdDEuaXNEaXJlY3RvcnkoKSAhPT0gc3RhdDIuaXNEaXJlY3RvcnkoKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgaWYgKHN0YXQxLmlzRGlyZWN0b3J5KCkpIHJldHVybiB0cnVlO1xuXG4gICAgICAgICAgICByZXR1cm4gY2FsY3VsYXRlRmlsZUhhc2goZmlsZTFQYXRoKSA9PT0gY2FsY3VsYXRlRmlsZUhhc2goZmlsZTJQYXRoKTtcbiAgICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbn1cblxuLyoqXG4gKiBNb3ZlIGRpcmVjdG9yeSBjb250ZW50cyBmcm9tIHNvdXJjZSB0byB0YXJnZXRcbiAqL1xuZnVuY3Rpb24gbW92ZURpcmVjdG9yeUNvbnRlbnRzKHNvdXJjZURpcjogc3RyaW5nLCB0YXJnZXREaXI6IHN0cmluZykge1xuICAgIGlmICghZXhpc3RzU3luYyh0YXJnZXREaXIpKSB7XG4gICAgICAgIG1rZGlyU3luYyh0YXJnZXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGVzID0gcmVhZGRpclN5bmMoc291cmNlRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KSBhcyBzdHJpbmdbXTtcbiAgICBmaWxlcy5mb3JFYWNoKGZpbGUgPT4ge1xuICAgICAgICBjb25zdCBzb3VyY2VQYXRoID0gcGF0aEpvaW4oc291cmNlRGlyLCBmaWxlKTtcbiAgICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IHBhdGhKb2luKHRhcmdldERpciwgZmlsZSk7XG5cbiAgICAgICAgaWYgKGxzdGF0U3luYyhzb3VyY2VQYXRoKS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmModGFyZ2V0UGF0aCkpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmModGFyZ2V0UGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAoZXhpc3RzU3luYyh0YXJnZXRQYXRoKSkge1xuICAgICAgICAgICAgICAgIHJtU3luYyh0YXJnZXRQYXRoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlbmFtZVN5bmMoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCk7XG4gICAgICAgIH1cbiAgICB9KTtcbn1cblxuLyoqXG4gKiBDbGVhbnMgdXAgYSB0ZW1wb3JhcnkgZGlyZWN0b3J5IGJ5IHJlbW92aW5nIGFsbCBmaWxlcyBhbmQgc3ViZGlyZWN0b3JpZXMuXG4gKiBAcGFyYW0gZGlyZWN0b3J5IC0gVGhlIGRpcmVjdG9yeSB0byBjbGVhbiB1cC5cbiAqL1xuZnVuY3Rpb24gY2xlYW51cERpcmVjdG9yeShkaXJlY3Rvcnk6IHN0cmluZykge1xuICAgIHRyeSB7XG4gICAgICAgIHJtU3luYyhkaXJlY3RvcnksIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBidW5kbGVXaXRoRXNidWlsZDogQ2xlYW5lZCB1cCB0ZW1wb3JhcnkgZGlyZWN0b3J5OiAke2RpcmVjdG9yeX1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmVycm9yKGBidW5kbGVXaXRoRXNidWlsZDogRmFpbGVkIHRvIGNsZWFuIHVwIGRpcmVjdG9yeSAke2RpcmVjdG9yeX06YCwgZXJyb3IpO1xuICAgIH1cbn1cbiJdfQ==