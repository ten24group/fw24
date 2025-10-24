import { DeploymentUnitDescriptor, Manifest } from './types';
export interface DUMappingResult {
    deploymentUnits: DeploymentUnitDescriptor[];
    capabilityToDU: Map<string, string>;
}
export declare function mapCapabilitiesToDUs(manifest: Manifest): DUMappingResult;
