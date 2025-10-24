import { CapabilityDescriptor, CapabilityRoute, DeploymentUnitDescriptor, Manifest, ModuleDescriptor, ResourceIntent } from './types';

// Simple type guards and validators (Phase 1 scope)

export function isNonEmptyString(value: any): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateRoute(route: CapabilityRoute, errors: string[], pathPrefix: string) {
  if (!isNonEmptyString(route.method)) errors.push(`${pathPrefix}.method missing`);
  if (!isNonEmptyString(route.path)) errors.push(`${pathPrefix}.path missing`);
  if (route.target && route.target !== 'function' && !isNonEmptyString(route.targetName)) {
    errors.push(`${pathPrefix}.targetName required when target=${route.target}`);
  }
}

export function validateCapability(cap: CapabilityDescriptor, errors: string[], index: number) {
  const prefix = `capabilities[${index}]`;
  if (!isNonEmptyString(cap.id)) errors.push(`${prefix}.id missing`);
  if (!isNonEmptyString(cap.sourceFile)) errors.push(`${prefix}.sourceFile missing`);
  if (!isNonEmptyString(cap.exportName)) errors.push(`${prefix}.exportName missing`);
  if (cap.routing?.routes) cap.routing.routes.forEach((r, i) => validateRoute(r, errors, `${prefix}.routing.routes[${i}]`));
}

export function validateResourceIntent(intent: ResourceIntent, errors: string[], index: number) {
  const prefix = `resourceIntents[${index}]`;
  if (!isNonEmptyString(intent.kind)) errors.push(`${prefix}.kind missing`);
  if (!isNonEmptyString(intent.name)) errors.push(`${prefix}.name missing`);
  if (!Array.isArray(intent.permissions) || intent.permissions.length === 0) errors.push(`${prefix}.permissions missing`);
}

export function validateModule(mod: ModuleDescriptor, errors: string[], index: number) {
  const prefix = `modules[${index}]`;
  if (!isNonEmptyString(mod.name)) errors.push(`${prefix}.name missing`);
  if (!isNonEmptyString(mod.path)) errors.push(`${prefix}.path missing`);
}

export function validateDeploymentUnit(du: DeploymentUnitDescriptor, errors: string[], index: number) {
  const prefix = `deploymentUnits[${index}]`;
  if (!isNonEmptyString(du.name)) errors.push(`${prefix}.name missing`);
  if (!isNonEmptyString(du.kind)) errors.push(`${prefix}.kind missing`);
  if (du.iam?.allowWildcard && !isNonEmptyString(du.iam.justification || '')) errors.push(`${prefix}.iam.justification required when allowWildcard=true`);
}

export function validateManifest(manifest: Manifest): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (manifest.manifestVersion !== '1.0.0') errors.push(`manifestVersion must be '1.0.0'`);
  if (!manifest.app || !isNonEmptyString(manifest.app.name)) errors.push(`app.name missing`);
  if (!isNonEmptyString(manifest.app?.version || '')) errors.push(`app.version missing`);

  (manifest.modules || []).forEach((m, i) => validateModule(m, errors, i));
  (manifest.capabilities || []).forEach((c, i) => validateCapability(c, errors, i));
  (manifest.resourceIntents || []).forEach((r, i) => validateResourceIntent(r, errors, i));
  (manifest.deploymentUnits || []).forEach((d, i) => validateDeploymentUnit(d, errors, i));

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}


