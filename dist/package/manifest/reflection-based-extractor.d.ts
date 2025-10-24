import 'reflect-metadata';
import type { ModuleDescriptor, EntityDescriptor, CapabilityDescriptor, ResourceIntent } from './types';
export interface ReflectionExtractionOptions {
    rootDir: string;
    cacheDir?: string;
    skipCache?: boolean;
    parallel?: boolean;
}
export interface ReflectionExtractionResult {
    modules: ModuleDescriptor[];
    entities: EntityDescriptor[];
    capabilities: CapabilityDescriptor[];
    resourceIntents: ResourceIntent[];
}
/**
 * Production-grade reflection-based manifest extractor
 *
 * This extractor:
 * 1. Compiles TypeScript to JavaScript in a temp directory
 * 2. Imports compiled JavaScript modules to trigger decorators
 * 3. Uses reflect-metadata to extract stored metadata
 * 4. Caches results based on source file hashes
 */
export declare class ReflectionBasedExtractor {
    private readonly options;
    private readonly cacheFile;
    private cache;
    constructor(options: ReflectionExtractionOptions);
    /**
     * Extract manifest data using reflection
     */
    extract(): Promise<ReflectionExtractionResult>;
    /**
     * Compile TypeScript to JavaScript
     */
    private compileTypeScript;
    /**
     * Find all compiled JavaScript files
     */
    private findCompiledFiles;
    /**
     * Extract metadata from compiled JavaScript files
     */
    private extractFromCompiledFiles;
    /**
     * Extract metadata from a single compiled file
     */
    private extractFromFile;
    /**
     * Extract controller capability with routes
     */
    private extractControllerCapability;
    /**
     * Extract routes from controller class methods using reflection
     */
    private extractRoutesFromClass;
    /**
     * Extract queue capability
     */
    private extractQueueCapability;
    /**
     * Extract task capability
     */
    private extractTaskCapability;
    /**
     * Extract resource intents from config using proper translation
     */
    private extractResourceIntents;
    /**
     * Extract entity metadata from global registry
     */
    private extractEntityMetadata;
    /**
     * Utility functions
     */
    private getRelativeSourcePath;
    private mergeResults;
    private calculateFileHash;
    private ensureDirectory;
    private loadCache;
    private saveCache;
}
