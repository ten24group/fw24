// constructs/source-to-layer-construct.ts
import { basename as pathBaseName, resolve as pathResolve, join as pathJoin, extname as pathExtname} from 'path';
import {existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs';
import { LayerConstruct } from './layer';
import { Construct } from 'constructs';
import { createLogger, LogDuration } from '../logging';

import {build, BuildOptions} from 'esbuild';
import { LayerVersionProps } from 'aws-cdk-lib/aws-lambda';
import { FW24Construct, FW24ConstructOutput } from '../interfaces';
import { Fw24 } from '../core';

// Scan a directory recursively and return a list of TypeScript files
export function scanDirectory(directory: string): string[] {
  let files: string[] = [];
  directory = pathResolve(directory);
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

export function getLayerName(target: any) {
  return Reflect.get(target, 'layerName');
}

export function isLayerEntry(target: any): boolean {
    return getLayerName(target) !== undefined;
}

// get layer metadata
export function getLayerProps(target: any): LayerVersionProps | undefined {
    return Reflect.get(target, 'layerProps');
}

// get layer build options
export function getLayerBuildOptions(target: any): BuildOptions | undefined {
    return Reflect.get(target, 'buildOptions');
}

// Cleanup temporary directories or files
export function cleanupDirectory(directory: string) {
  try {
    rmSync(directory, { recursive: true, force: true });
    console.log(`Cleaned up temporary directory: ${directory}`);
  } catch (error) {
    console.error(`Failed to clean up directory ${directory}:`, error);
  }
}

// Handle build errors with detailed logging
export function handleBuildError(error: Error, filePath: string) {
  const errorMessage = `Failed to bundle file ${filePath}. Error: ${error.message}.`;
  console.error(errorMessage);
  // Add more detailed logging or actions if needed
  // For example, notify a monitoring system, send an alert, etc.
}

// Utility function for bundling with esbuild
export async function bundleWithEsbuild(entryFile: string, outputFile: string, buildOptions: BuildOptions) {
    const defaultOptions: BuildOptions = {
        bundle: true,
        platform: 'node',
        target: 'node18',
        minify: true,
        sourcemap: false,
        external: buildOptions.external || [], // Specify external packages
        ...buildOptions, // Override with specific build options
        outfile: outputFile,
        entryPoints: [entryFile],
    };

    console.log(`Bundling ${entryFile} into ${outputFile} with options:`, defaultOptions);
    await build(defaultOptions);
}


interface SourceToLayersConstructProps {
    directory: string; // Directory to scan for entry files
    distDirectory?: string; // Configurable output directory
}

export class SourceToLayersConstruct implements FW24Construct {
    readonly logger = createLogger(SourceToLayersConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name = LayerConstruct.name;
    output!: FW24ConstructOutput;
    dependencies: string[] = [];

    constructor(private readonly props: SourceToLayersConstructProps) {
    }
    
    @LogDuration()
    async construct() {
        const distDirectory = this.props.distDirectory || pathJoin(__dirname, '../../dist');
        await this.processFiles(this.props.directory, distDirectory);
    }

    // Process TypeScript files and create layers
    private async processFiles(sourceDirectory: string, distDirectory: string) {
        const tsFiles = scanDirectory(sourceDirectory);

        // Process files in parallel using Promise.all
        await Promise.all(
            tsFiles.map(async (file) => {
                try {
                    await this.tryCreateLayerForFile(file, distDirectory);
                } catch (error) {
                    this.logger.error(`Failed to bundle file ${file}. Error:`, error);
                    throw error;
                }
            })
        )
        .catch(
            error => this.logger.error('Error processing files:', error)
        );
    }

    // Create a Lambda layer for a given TypeScript file
    private async tryCreateLayerForFile(file: string, distDirectory: string) {
        const fileBaseName = pathBaseName(file, pathExtname(file));
        const outputDir = pathJoin(distDirectory, fileBaseName);
        const outputFile = pathJoin(outputDir, 'index.js');

        const moduleExports = await import(file);

        const layerDescriptorName = Object.keys(moduleExports).find((key) => {
            const exported = moduleExports[key];
            if (typeof exported === 'function' && isLayerEntry(exported)) {
                return exported;
            }
        });

        if(!layerDescriptorName){
            this.logger.warn(`No LayerEntry found in file ${file}. [Ignoring].`);
            return;
        }

        const layerDescriptor = moduleExports[layerDescriptorName];

        // Extract build options and layerProps from metadata
        const layerProps = getLayerProps(layerDescriptor) || {};
        const buildOptions = getLayerBuildOptions(layerDescriptor) || {};
        const layerName = getLayerName(layerDescriptor);

        // Ensure the output directory exists
        if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true });
        }

        // Use the utility function to bundle the entry file
        await bundleWithEsbuild(file, outputFile, buildOptions);

        // Create the layer using LayerConstruct
        const layerConstruct = new LayerConstruct([{
            layerName: layerName,
            layerDirectory: outputDir,
            layerProps,
        }]);

        await layerConstruct.construct();

        // Clean up the temporary output directory
        // ?? make it configurable ??
        // cleanupDirectory(outputDir);
    }
}
