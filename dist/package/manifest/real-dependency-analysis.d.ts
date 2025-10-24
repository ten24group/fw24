import { Manifest, CapabilityDescriptor } from './types';
export interface RealDUDependencies {
    modules: ModuleInfo[];
    entities: EntityInfo[];
    controllers: ControllerInfo[];
    diRegistrations: DIRegistration[];
}
export interface ModuleInfo {
    name: string;
    className: string;
    importPath: string;
    hasRuntimeProviders: boolean;
    dependencies: string[];
}
export interface EntityInfo {
    name: string;
    schemaToken: string;
    schemaFactory: string;
    schemaImportPath: string;
    serviceToken?: string;
    serviceClass?: string;
    serviceImportPath?: string;
    providedIn: string;
}
export interface ControllerInfo {
    name: string;
    className: string;
    importPath: string;
    basePath: string;
}
export interface DIRegistration {
    type: 'module' | 'entity' | 'service' | 'controller';
    code: string;
}
/**
 * Real dependency analysis that understands the fw24 framework patterns:
 * - @DIModule decorators and module registration
 * - registerEntitySchema() calls
 * - Module dependencies and topological ordering
 * - Proper DI container setup
 */
export declare function analyzeRealDUDependencies(_duName: string, capabilities: CapabilityDescriptor[], manifest: Manifest, rootDir?: string): RealDUDependencies;
