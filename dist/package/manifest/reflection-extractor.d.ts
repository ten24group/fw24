import { CapabilityDescriptor, ResourceIntent } from './types';
/**
 * PROPER reflection-based manifest extraction
 * Uses decorator metadata instead of hacky AST parsing
 */
export interface ReflectionExtractionResult {
    modules: any[];
    entities: any[];
    capabilities: CapabilityDescriptor[];
    resourceIntents: ResourceIntent[];
}
/**
 * Extract manifest data using reflection and decorator metadata
 * This is the CLEAN, SCALABLE way to do it!
 */
export declare function extractManifestViaReflection(rootDir: string): ReflectionExtractionResult;
