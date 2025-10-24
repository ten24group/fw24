import { CapabilityDescriptor, CapabilityRoute, DeploymentUnitDescriptor, Manifest, ModuleDescriptor, ResourceIntent } from './types';
export declare function isNonEmptyString(value: any): value is string;
export declare function validateRoute(route: CapabilityRoute, errors: string[], pathPrefix: string): void;
export declare function validateCapability(cap: CapabilityDescriptor, errors: string[], index: number): void;
export declare function validateResourceIntent(intent: ResourceIntent, errors: string[], index: number): void;
export declare function validateModule(mod: ModuleDescriptor, errors: string[], index: number): void;
export declare function validateDeploymentUnit(du: DeploymentUnitDescriptor, errors: string[], index: number): void;
export declare function validateManifest(manifest: Manifest): {
    ok: true;
} | {
    ok: false;
    errors: string[];
};
