import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { CapabilityDescriptor, CapabilityRef, DeploymentUnitDescriptor, EntityDescriptor, EntityRef, Manifest, ManifestApp, ModuleDescriptor, ProviderDescriptor, ResourceIntent } from './types';

export interface RegistryFile<T> {
  items: T[];
}

export interface ModuleRegistryItem extends Omit<ModuleDescriptor, 'runtime' | 'buildExports'> {
  buildExports?: ModuleDescriptor['buildExports'];
  runtime?: {
    providers?: ProviderDescriptor[];
    entities?: EntityRef[];
    capabilities?: CapabilityRef[];
    tags?: string[];
  };
}

export interface CapabilityRegistryItem extends CapabilityDescriptor {}
export interface EntityRegistryItem extends EntityDescriptor {}
export interface ResourceIntentRegistryItem extends ResourceIntent {}
export interface DeploymentUnitRegistryItem extends DeploymentUnitDescriptor {}

export interface AppRegistry {
  app: ManifestApp;
}

export interface LoadedRegistries {
  app: ManifestApp;
  modules: ModuleRegistryItem[];
  entities: EntityRegistryItem[];
  capabilities: CapabilityRegistryItem[];
  resourceIntents: ResourceIntentRegistryItem[];
  deploymentUnits: DeploymentUnitRegistryItem[];
}

export function loadRegistries(rootDir = process.cwd()): LoadedRegistries {
  const base = join(rootDir, '.fw24', 'registries');

  const readJson = <T>(file: string, fallback: T): T => {
    const full = join(base, file);
    if (!existsSync(full)) return fallback;
    const raw = readFileSync(full, 'utf-8');
    return JSON.parse(raw) as T;
  };

  const appReg = readJson<AppRegistry>('app.json', { app: { name: 'app', version: '0.0.0' } });
  const modulesReg = readJson<RegistryFile<ModuleRegistryItem>>('modules.json', { items: [] });
  const entitiesReg = readJson<RegistryFile<EntityRegistryItem>>('entities.json', { items: [] });
  const capsReg = readJson<RegistryFile<CapabilityRegistryItem>>('capabilities.json', { items: [] });
  const intentsReg = readJson<RegistryFile<ResourceIntentRegistryItem>>('resource-intents.json', { items: [] });
  const dusReg = readJson<RegistryFile<DeploymentUnitRegistryItem>>('deployment-units.json', { items: [] });

  return {
    app: appReg.app,
    modules: modulesReg.items,
    entities: entitiesReg.items,
    capabilities: capsReg.items,
    resourceIntents: intentsReg.items,
    deploymentUnits: dusReg.items,
  };
}


