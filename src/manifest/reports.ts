import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Manifest, CapabilityDescriptor, ResourceIntent } from './types';

/**
 * Generate all required reports as specified in du-plan.md Section 28:
 * - routes.md - Route mapping and conflicts
 * - capabilities.md - All discovered capabilities  
 * - intents.md - Resource intents and IAM policies
 * - bundles.json - Bundle size and dependency metrics
 */
export function generateReports(manifest: Manifest, reportsDir: string): void {
  console.log('Generating reports...');
  
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }

  generateRoutesReport(manifest, reportsDir);
  generateCapabilitiesReport(manifest, reportsDir);
  generateIntentsReport(manifest, reportsDir);
  generateBundlesReport(manifest, reportsDir);
}

function generateRoutesReport(manifest: Manifest, reportsDir: string): void {
  const routesFile = join(reportsDir, 'routes.md');
  let content = '# Route Mapping Report\n\n';
  
  content += `Generated: ${new Date().toISOString()}\n\n`;
  
  // Extract all routes from capabilities
  const allRoutes: Array<{
    capability: CapabilityDescriptor;
    method: string;
    path: string;
    fullPath: string;
    authorizer?: any;
  }> = [];

  const routeConflicts: Array<{
    signature: string;
    capabilities: CapabilityDescriptor[];
  }> = [];

  for (const capability of manifest.capabilities) {
    if (capability.kind === 'controller' && capability.routing?.routes) {
      const basePath = capability.routing.basePath || '';
      
      for (const route of capability.routing.routes) {
        const fullPath = `${basePath}${route.path}`.replace(/\/+/g, '/');
        const routeSignature = `${route.method}:${fullPath}`;
        
        allRoutes.push({
          capability,
          method: route.method,
          path: route.path,
          fullPath,
          authorizer: route.authorizer
        });

        // Check for conflicts - more robust detection
        const existingConflict = routeConflicts.find(c => c.signature === routeSignature);
        if (existingConflict) {
          // Add to existing conflict if not already there
          if (!existingConflict.capabilities.some(cap => cap.id === capability.id)) {
            existingConflict.capabilities.push(capability);
          }
        } else {
          // Look for other routes with same method and path
          const conflictingRoute = allRoutes.find(r => 
            r !== allRoutes[allRoutes.length - 1] && // Not the current route we just added
            r.method === route.method && r.fullPath === fullPath
          );
          
          if (conflictingRoute) {
            routeConflicts.push({
              signature: routeSignature,
              capabilities: [conflictingRoute.capability, capability]
            });
          }
        }
      }
    }
  }

  // Route conflicts section
  if (routeConflicts.length > 0) {
    content += '## ⚠️ Route Conflicts Detected\n\n';
    for (const conflict of routeConflicts) {
      content += `### \`${conflict.signature}\`\n\n`;
      content += 'Conflicting capabilities:\n';
      for (const cap of conflict.capabilities) {
        content += `- **${cap.exportName}** in \`${cap.sourceFile}\`\n`;
      }
      content += '\n';
    }
    content += '\n';
  } else {
    content += '## ✅ No Route Conflicts\n\n';
  }

  // All routes section
  content += '## All Routes\n\n';
  content += '| Method | Path | Controller | Source File | Authorizer |\n';
  content += '|--------|------|------------|-------------|------------|\n';

  // Sort routes by method and path
  allRoutes.sort((a, b) => {
    if (a.method !== b.method) return a.method.localeCompare(b.method);
    return a.fullPath.localeCompare(b.fullPath);
  });

  for (const route of allRoutes) {
    const authInfo = route.authorizer 
      ? (typeof route.authorizer === 'string' ? route.authorizer : route.authorizer.type || 'Custom')
      : 'None';
    
    content += `| ${route.method} | \`${route.fullPath}\` | ${route.capability.exportName} | \`${route.capability.sourceFile}\` | ${authInfo} |\n`;
  }

  content += `\n**Total Routes:** ${allRoutes.length}\n`;
  content += `**Route Conflicts:** ${routeConflicts.length}\n`;

  writeFileSync(routesFile, content);
  console.log(`Routes report generated: ${routesFile}`);
}

function generateCapabilitiesReport(manifest: Manifest, reportsDir: string): void {
  const capabilitiesFile = join(reportsDir, 'capabilities.md');
  let content = '# Capabilities Report\n\n';
  
  content += `Generated: ${new Date().toISOString()}\n\n`;

  // Group capabilities by kind
  const capabilitiesByKind = manifest.capabilities.reduce((acc, cap) => {
    if (!acc[cap.kind]) acc[cap.kind] = [];
    acc[cap.kind].push(cap);
    return acc;
  }, {} as Record<string, CapabilityDescriptor[]>);

  content += '## Summary\n\n';
  for (const [kind, caps] of Object.entries(capabilitiesByKind)) {
    content += `- **${kind}**: ${caps.length} capabilities\n`;
  }
  content += `\n**Total:** ${manifest.capabilities.length} capabilities\n\n`;

  // Detailed sections for each kind
  for (const [kind, caps] of Object.entries(capabilitiesByKind)) {
    content += `## ${kind.charAt(0).toUpperCase() + kind.slice(1)} Capabilities\n\n`;
    
    content += '| Name | Source File | Tags | Resource Intents |\n';
    content += '|------|-------------|------|------------------|\n';

    for (const cap of caps) {
      const tags = cap.tags?.join(', ') || 'None';
      const intents = cap.requires?.resourceIntents?.length || 0;
      content += `| ${cap.exportName} | \`${cap.sourceFile}\` | ${tags} | ${intents} |\n`;
    }
    content += '\n';
  }

  // Module breakdown
  content += '## Module Breakdown\n\n';
  const capsByModule = manifest.capabilities.reduce((acc, cap) => {
    // Extract module from source file path
    const moduleName = cap.sourceFile.split('/')[1] || 'unknown';
    if (!acc[moduleName]) acc[moduleName] = [];
    acc[moduleName].push(cap);
    return acc;
  }, {} as Record<string, CapabilityDescriptor[]>);

  for (const [module, caps] of Object.entries(capsByModule)) {
    content += `### ${module}\n\n`;
    for (const cap of caps) {
      content += `- **${cap.exportName}** (${cap.kind})\n`;
    }
    content += '\n';
  }

  writeFileSync(capabilitiesFile, content);
  console.log(`Capabilities report generated: ${capabilitiesFile}`);
}

function generateIntentsReport(manifest: Manifest, reportsDir: string): void {
  const intentsFile = join(reportsDir, 'intents.md');
  let content = '# Resource Intents Report\n\n';
  
  content += `Generated: ${new Date().toISOString()}\n\n`;

  content += '## Summary\n\n';
  
  // Group intents by kind
  const intentsByKind = manifest.resourceIntents.reduce((acc, intent) => {
    if (!acc[intent.kind]) acc[intent.kind] = [];
    acc[intent.kind].push(intent);
    return acc;
  }, {} as Record<string, ResourceIntent[]>);

  for (const [kind, intents] of Object.entries(intentsByKind)) {
    content += `- **${kind}**: ${intents.length} intents\n`;
  }
  content += `\n**Total:** ${manifest.resourceIntents.length} resource intents\n\n`;

  // Detailed breakdown
  content += '## Resource Intents by Type\n\n';
  
  for (const [kind, intents] of Object.entries(intentsByKind)) {
    content += `### ${kind.charAt(0).toUpperCase() + kind.slice(1)} Resources\n\n`;
    
    content += '| Resource Name | Permissions | Scope |\n';
    content += '|---------------|-------------|-------|\n';

    for (const intent of intents) {
      const permissions = intent.permissions.join(', ');
      const scope = intent.scope ? 
        (intent.scope.index ? `Index: ${intent.scope.index}` : 
         intent.scope.prefix ? `Prefix: ${intent.scope.prefix}` : 'None') : 'None';
      content += `| ${intent.name} | ${permissions} | ${scope} |\n`;
    }
    content += '\n';
  }

  // Capability-level intents
  content += '## Capabilities with Resource Intents\n\n';
  
  const capsWithIntents = manifest.capabilities.filter(cap => 
    cap.requires?.resourceIntents && cap.requires.resourceIntents.length > 0
  );

  if (capsWithIntents.length > 0) {
    content += '| Capability | Kind | Intents |\n';
    content += '|------------|------|--------|\n';

    for (const cap of capsWithIntents) {
      const intentsList = cap.requires!.resourceIntents!.map(intent => 
        `${intent.kind}:${intent.name} (${intent.permissions.join(',')})`
      ).join('<br>');
      content += `| ${cap.exportName} | ${cap.kind} | ${intentsList} |\n`;
    }
  } else {
    content += '*No capabilities have explicit resource intents declared.*\n';
  }

  content += '\n## IAM Policy Recommendations\n\n';
  content += 'Based on the resource intents, the following IAM policies should be generated:\n\n';

  for (const [kind, intents] of Object.entries(intentsByKind)) {
    content += `### ${kind} Policies\n\n`;
    content += '```json\n';
    content += JSON.stringify({
      Version: '2012-10-17',
      Statement: intents.map(intent => ({
        Effect: 'Allow',
        Action: intent.permissions.map(perm => `${kind}:${perm}`),
        Resource: intent.scope?.prefix 
          ? `arn:aws:${kind}:*:*:${intent.name}${intent.scope.prefix}*`
          : `arn:aws:${kind}:*:*:${intent.name}`
      }))
    }, null, 2);
    content += '\n```\n\n';
  }

  writeFileSync(intentsFile, content);
  console.log(`Intents report generated: ${intentsFile}`);
}

function generateBundlesReport(manifest: Manifest, reportsDir: string): void {
  const bundlesFile = join(reportsDir, 'bundles.json');
  
  // Generate bundle metrics for each deployment unit
  const bundleReport = {
    generatedAt: new Date().toISOString(),
    deploymentUnits: manifest.deploymentUnits.map(du => ({
      name: du.name,
      kind: du.kind,
      capabilities: manifest.capabilities.filter(cap => {
        // Simple matching - in practice this would be more sophisticated
        return du.include?.capabilities?.some(includeCap => 
          typeof includeCap === 'string' ? includeCap === cap.id :
          includeCap.kind === cap.kind
        ) ?? true; // Default to include all if no specific include rules
      }).map(cap => ({
        id: cap.id,
        kind: cap.kind,
        sourceFile: cap.sourceFile,
        estimatedSize: estimateCapabilitySize(cap)
      })),
      estimatedBundleSize: 0, // Will be calculated
      dependencies: [] as string[],
      sharedDependencies: [] as string[]
    })),
    sharedLayers: {
      vendor: {
        estimatedSize: 1024 * 1024, // 1MB estimate
        packages: ['@aws-sdk', '@ten24group/fw24', 'electrodb']
      }
    },
    recommendations: [] as string[]
  };

  // Calculate bundle sizes and add recommendations
  for (const du of bundleReport.deploymentUnits) {
    du.estimatedBundleSize = du.capabilities.reduce((sum, cap) => sum + cap.estimatedSize, 0);
    
    if (du.estimatedBundleSize > 10 * 1024 * 1024) { // > 10MB
      bundleReport.recommendations.push(
        `${du.name}: Bundle size (${(du.estimatedBundleSize / 1024 / 1024).toFixed(1)}MB) exceeds 10MB recommendation`
      );
    }

    if (du.capabilities.length > 20) {
      bundleReport.recommendations.push(
        `${du.name}: High capability count (${du.capabilities.length}) may impact cold start`
      );
    }
  }

  writeFileSync(bundlesFile, JSON.stringify(bundleReport, null, 2));
  console.log(`Bundles report generated: ${bundlesFile}`);
}

function estimateCapabilitySize(capability: CapabilityDescriptor): number {
  // Simple size estimation based on capability type
  switch (capability.kind) {
    case 'controller':
      // Controllers typically have more code
      const routeCount = capability.routing?.routes?.length || 1;
      return routeCount * 5 * 1024; // 5KB per route estimate
    case 'queue':
    case 'task':
    case 'stream':
      return 2 * 1024; // 2KB estimate for handlers
    default:
      return 1 * 1024; // 1KB default
  }
}
