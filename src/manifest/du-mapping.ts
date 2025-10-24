import { CapabilityDescriptor, DeploymentUnitDescriptor, Manifest } from './types';

export interface DUMappingResult {
  deploymentUnits: DeploymentUnitDescriptor[];
  capabilityToDU: Map<string, string>; // capability.id -> DU name
}

export function mapCapabilitiesToDUs(manifest: Manifest): DUMappingResult {
  const capabilities = manifest.capabilities;
  const existingDUs = manifest.deploymentUnits || [];
  
  // Start with existing DUs from manifest
  const deploymentUnits: DeploymentUnitDescriptor[] = [...existingDUs];
  const capabilityToDU = new Map<string, string>();
  
  // Apply existing DU mappings first
  for (const du of existingDUs) {
    if (du.include?.capabilities) {
      for (const capMatch of du.include.capabilities) {
        const matchingCaps = findMatchingCapabilities(capabilities, capMatch);
        for (const cap of matchingCaps) {
          capabilityToDU.set(cap.id, du.name);
        }
      }
    }
  }
  
  // Apply default strategy for unmapped capabilities
  const unmappedCaps = capabilities.filter(cap => !capabilityToDU.has(cap.id));
  
  for (const cap of unmappedCaps) {
    const duName = getDefaultDUName(cap);
    
    // Find or create DU
    let du = deploymentUnits.find(d => d.name === duName);
    if (!du) {
      du = createDefaultDU(cap, duName);
      deploymentUnits.push(du);
    }
    
    capabilityToDU.set(cap.id, duName);
  }
  
  return { deploymentUnits, capabilityToDU };
}

function findMatchingCapabilities(
  capabilities: CapabilityDescriptor[], 
  match: any
): CapabilityDescriptor[] {
  return capabilities.filter(cap => {
    if (typeof match === 'string') {
      return cap.id === match;
    }
    
    if (match.kind && cap.kind !== match.kind) return false;
    if (match.tag && (!cap.tags || !cap.tags.includes(match.tag))) return false;
    if (match.id && cap.id !== match.id) return false;
    
    return true;
  });
}

function getDefaultDUName(cap: CapabilityDescriptor): string {
  switch (cap.kind) {
    case 'controller':
      return 'api'; // All controllers go to single API DU by default
    case 'queue':
      return `${cap.queue?.name || cap.id}-queue`;
    case 'task':
      return `${cap.id}-task`;
    case 'stream':
      return `${cap.stream?.table || cap.id}-stream`;
    default:
      return `${cap.id}-worker`;
  }
}

function createDefaultDU(cap: CapabilityDescriptor, name: string): DeploymentUnitDescriptor {
  const kind = cap.kind === 'controller' ? 'api' : 
               cap.kind === 'stream' ? 'stream' : 'worker';
  
  return {
    name,
    kind,
    include: {
      capabilities: [{ kind: cap.kind }]
    }
  };
}
