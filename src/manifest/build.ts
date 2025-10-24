import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadRegistries } from './registry';
import { ReflectionBasedExtractor } from './reflection-based-extractor';
import { extractCapabilities } from './extract';
import { Manifest } from './types';
import { validateManifest } from './validate';
import { writeBundleReport } from './bundles';
import { writeAuthorizerPolicyReport } from './authz-report';
import { generateReports } from './reports';
import { mapCapabilitiesToDUs, DUMappingResult } from './du-mapping';
import { generateDUBootstraps } from './bootstrap-gen';

export interface BuildOptions {
  rootDir?: string;
  outDir?: string; // default .fw24/out
  reportsDir?: string; // default .fw24/reports
}

export function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export async function buildManifest(options: BuildOptions = {}) {
  const root = options.rootDir || process.cwd();
  const outDir = options.outDir || join(root, '.fw24', 'out');
  const reportsDir = options.reportsDir || join(root, '.fw24', 'reports');

  const regs = loadRegistries(root);

  // Extract manifest data using production reflection system
  console.log('Extracting manifest via production reflection system...');
  
  let reflectionResult;
  try {
    const extractor = new ReflectionBasedExtractor({ rootDir: root });
    reflectionResult = await extractor.extract();
    console.log(`[Build] Reflection extraction successful: ${reflectionResult.capabilities.length} capabilities found`);
  } catch (error: any) {
    console.warn(`[Build] Reflection extraction failed: ${error.message}`);
    console.log('[Build] Falling back to AST extraction...');
    reflectionResult = { modules: [], entities: [], capabilities: [], resourceIntents: [] };
  }

  // Use reflection-extracted capabilities, fallback to AST if needed
  let capabilities = reflectionResult.capabilities;
  if (capabilities.length === 0) {
    console.log('[Build] No capabilities from reflection, using AST extraction...');
    const astResult = extractCapabilities(root);
    capabilities = astResult.capabilities;
  }

  const manifest: Manifest = {
    manifestVersion: '1.0.0',
    app: regs.app,
    modules: reflectionResult.modules.length > 0 ? reflectionResult.modules : regs.modules,
    entities: reflectionResult.entities.length > 0 ? reflectionResult.entities : regs.entities,
    capabilities: capabilities.length > 0 ? capabilities : regs.capabilities,
    resourceIntents: reflectionResult.resourceIntents.length > 0 ? reflectionResult.resourceIntents : regs.resourceIntents,
    deploymentUnits: regs.deploymentUnits,
  } as Manifest;

  // Map capabilities to DUs and update manifest
  const duMapping = mapCapabilitiesToDUs(manifest);
  manifest.deploymentUnits = duMapping.deploymentUnits;

  // Validate
  const result = validateManifest(manifest);
  ensureDir(outDir);
  ensureDir(reportsDir);

  // Generate DU bootstraps
  const generatedDir = join(root, '.fw24', '.generated');
  generateDUBootstraps(manifest, duMapping, { 
    outputDir: generatedDir, 
    rootDir: root 
  });

  // Write manifest
  const manifestPath = join(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Reports (Phase 1 minimal set)
  writeFileSync(join(reportsDir, 'capabilities.md'), renderCapabilitiesReport(manifest));
  writeFileSync(join(reportsDir, 'routes.md'), renderRoutesReport(manifest));
  writeFileSync(join(reportsDir, 'intents.md'), renderIntentsReport(manifest));
  writeFileSync(join(reportsDir, 'deployment-units.md'), renderDUReport(manifest, duMapping));
  writeAuthorizerPolicyReport(manifest, reportsDir);
  writeBundleReport({ rootDir: root, reportsDir });
  
  // Generate comprehensive reports as specified in du-plan.md
  generateReports(manifest, reportsDir);

  if (result.ok) {
    writeFileSync(join(reportsDir, 'validation.json'), JSON.stringify({ ok: true }, null, 2));
    return { ok: true, manifestPath } as const;
  } else {
    writeFileSync(join(reportsDir, 'validation.json'), JSON.stringify({ ok: false, errors: result.errors }, null, 2));
    return { ok: false, errors: result.errors, manifestPath } as const;
  }
}

function renderCapabilitiesReport(m: Manifest): string {
  const lines: string[] = [];
  lines.push(`# Capabilities`);
  m.capabilities.forEach(c => {
    lines.push(`- ${c.id} (${c.kind}) — ${c.sourceFile}::${c.exportName}`);
  });
  return lines.join('\n');
}

function renderRoutesReport(m: Manifest): string {
  const lines: string[] = [];
  lines.push(`# Routes`);
  m.capabilities.filter(c => c.kind === 'controller').forEach(c => {
    const base = c.routing?.basePath || '';
    (c.routing?.routes || []).forEach(r => {
      const auth = typeof r.authorizer === 'string' ? r.authorizer : r.authorizer?.type;
      const target = r.target || 'function';
      lines.push(`- ${c.id} ${r.method} ${base}${r.path}  auth=${auth || 'default'} target=${target}${r.targetName ? `(${r.targetName})` : ''}`);
    });
  });
  return lines.join('\n');
}

function renderIntentsReport(m: Manifest): string {
  const lines: string[] = [];
  lines.push(`# Resource Intents`);
  m.resourceIntents.forEach((ri) => {
    lines.push(`- ${ri.kind}:${ri.name} perms=[${ri.permissions.join(',')}]`);
  });
  return lines.join('\n');
}

function renderDUReport(m: Manifest, mapping: DUMappingResult): string {
  const lines: string[] = [];
  lines.push(`# Deployment Units`);
  lines.push('');
  
  for (const du of m.deploymentUnits) {
    lines.push(`## ${du.name} (${du.kind})`);
    
    const capabilities = m.capabilities.filter(cap => mapping.capabilityToDU.get(cap.id) === du.name);
    lines.push(`**Capabilities:** ${capabilities.length}`);
    
    for (const cap of capabilities) {
      lines.push(`- ${cap.id} (${cap.kind}) — ${cap.sourceFile}`);
    }
    
    lines.push(`**Generated Bootstrap:** .fw24/.generated/du-${du.name}.bootstrap.ts`);
    lines.push('');
  }
  
  return lines.join('\n');
}


