import { ModuleDescriptor, EntityDescriptor } from './types';
export interface ModuleExtractionResult {
    modules: ModuleDescriptor[];
    entities: EntityDescriptor[];
}
/**
 * Extract modules and entities from application source code using AST analysis
 * This populates the manifest.modules[] and manifest.entities[] arrays properly
 */
export declare function extractModulesAndEntities(rootDir: string): ModuleExtractionResult;
