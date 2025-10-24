"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReports = generateReports;
const fs_1 = require("fs");
const path_1 = require("path");
/**
 * Generate all required reports as specified in du-plan.md Section 28:
 * - routes.md - Route mapping and conflicts
 * - capabilities.md - All discovered capabilities
 * - intents.md - Resource intents and IAM policies
 * - bundles.json - Bundle size and dependency metrics
 */
function generateReports(manifest, reportsDir) {
    console.log('Generating reports...');
    if (!(0, fs_1.existsSync)(reportsDir)) {
        (0, fs_1.mkdirSync)(reportsDir, { recursive: true });
    }
    generateRoutesReport(manifest, reportsDir);
    generateCapabilitiesReport(manifest, reportsDir);
    generateIntentsReport(manifest, reportsDir);
    generateBundlesReport(manifest, reportsDir);
}
function generateRoutesReport(manifest, reportsDir) {
    const routesFile = (0, path_1.join)(reportsDir, 'routes.md');
    let content = '# Route Mapping Report\n\n';
    content += `Generated: ${new Date().toISOString()}\n\n`;
    // Extract all routes from capabilities
    const allRoutes = [];
    const routeConflicts = [];
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
                }
                else {
                    // Look for other routes with same method and path
                    const conflictingRoute = allRoutes.find(r => r !== allRoutes[allRoutes.length - 1] && // Not the current route we just added
                        r.method === route.method && r.fullPath === fullPath);
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
    }
    else {
        content += '## ✅ No Route Conflicts\n\n';
    }
    // All routes section
    content += '## All Routes\n\n';
    content += '| Method | Path | Controller | Source File | Authorizer |\n';
    content += '|--------|------|------------|-------------|------------|\n';
    // Sort routes by method and path
    allRoutes.sort((a, b) => {
        if (a.method !== b.method)
            return a.method.localeCompare(b.method);
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
    (0, fs_1.writeFileSync)(routesFile, content);
    console.log(`Routes report generated: ${routesFile}`);
}
function generateCapabilitiesReport(manifest, reportsDir) {
    const capabilitiesFile = (0, path_1.join)(reportsDir, 'capabilities.md');
    let content = '# Capabilities Report\n\n';
    content += `Generated: ${new Date().toISOString()}\n\n`;
    // Group capabilities by kind
    const capabilitiesByKind = manifest.capabilities.reduce((acc, cap) => {
        if (!acc[cap.kind])
            acc[cap.kind] = [];
        acc[cap.kind].push(cap);
        return acc;
    }, {});
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
        if (!acc[moduleName])
            acc[moduleName] = [];
        acc[moduleName].push(cap);
        return acc;
    }, {});
    for (const [module, caps] of Object.entries(capsByModule)) {
        content += `### ${module}\n\n`;
        for (const cap of caps) {
            content += `- **${cap.exportName}** (${cap.kind})\n`;
        }
        content += '\n';
    }
    (0, fs_1.writeFileSync)(capabilitiesFile, content);
    console.log(`Capabilities report generated: ${capabilitiesFile}`);
}
function generateIntentsReport(manifest, reportsDir) {
    const intentsFile = (0, path_1.join)(reportsDir, 'intents.md');
    let content = '# Resource Intents Report\n\n';
    content += `Generated: ${new Date().toISOString()}\n\n`;
    content += '## Summary\n\n';
    // Group intents by kind
    const intentsByKind = manifest.resourceIntents.reduce((acc, intent) => {
        if (!acc[intent.kind])
            acc[intent.kind] = [];
        acc[intent.kind].push(intent);
        return acc;
    }, {});
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
    const capsWithIntents = manifest.capabilities.filter(cap => cap.requires?.resourceIntents && cap.requires.resourceIntents.length > 0);
    if (capsWithIntents.length > 0) {
        content += '| Capability | Kind | Intents |\n';
        content += '|------------|------|--------|\n';
        for (const cap of capsWithIntents) {
            const intentsList = cap.requires.resourceIntents.map(intent => `${intent.kind}:${intent.name} (${intent.permissions.join(',')})`).join('<br>');
            content += `| ${cap.exportName} | ${cap.kind} | ${intentsList} |\n`;
        }
    }
    else {
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
    (0, fs_1.writeFileSync)(intentsFile, content);
    console.log(`Intents report generated: ${intentsFile}`);
}
function generateBundlesReport(manifest, reportsDir) {
    const bundlesFile = (0, path_1.join)(reportsDir, 'bundles.json');
    // Generate bundle metrics for each deployment unit
    const bundleReport = {
        generatedAt: new Date().toISOString(),
        deploymentUnits: manifest.deploymentUnits.map(du => ({
            name: du.name,
            kind: du.kind,
            capabilities: manifest.capabilities.filter(cap => {
                // Simple matching - in practice this would be more sophisticated
                return du.include?.capabilities?.some(includeCap => typeof includeCap === 'string' ? includeCap === cap.id :
                    includeCap.kind === cap.kind) ?? true; // Default to include all if no specific include rules
            }).map(cap => ({
                id: cap.id,
                kind: cap.kind,
                sourceFile: cap.sourceFile,
                estimatedSize: estimateCapabilitySize(cap)
            })),
            estimatedBundleSize: 0, // Will be calculated
            dependencies: [],
            sharedDependencies: []
        })),
        sharedLayers: {
            vendor: {
                estimatedSize: 1024 * 1024, // 1MB estimate
                packages: ['@aws-sdk', '@ten24group/fw24', 'electrodb']
            }
        },
        recommendations: []
    };
    // Calculate bundle sizes and add recommendations
    for (const du of bundleReport.deploymentUnits) {
        du.estimatedBundleSize = du.capabilities.reduce((sum, cap) => sum + cap.estimatedSize, 0);
        if (du.estimatedBundleSize > 10 * 1024 * 1024) { // > 10MB
            bundleReport.recommendations.push(`${du.name}: Bundle size (${(du.estimatedBundleSize / 1024 / 1024).toFixed(1)}MB) exceeds 10MB recommendation`);
        }
        if (du.capabilities.length > 20) {
            bundleReport.recommendations.push(`${du.name}: High capability count (${du.capabilities.length}) may impact cold start`);
        }
    }
    (0, fs_1.writeFileSync)(bundlesFile, JSON.stringify(bundleReport, null, 2));
    console.log(`Bundles report generated: ${bundlesFile}`);
}
function estimateCapabilitySize(capability) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVwb3J0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9tYW5pZmVzdC9yZXBvcnRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBV0EsMENBV0M7QUF0QkQsMkJBQTBEO0FBQzFELCtCQUE0QjtBQUc1Qjs7Ozs7O0dBTUc7QUFDSCxTQUFnQixlQUFlLENBQUMsUUFBa0IsRUFBRSxVQUFrQjtJQUNwRSxPQUFPLENBQUMsR0FBRyxDQUFDLHVCQUF1QixDQUFDLENBQUM7SUFFckMsSUFBSSxDQUFDLElBQUEsZUFBVSxFQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7UUFDNUIsSUFBQSxjQUFTLEVBQUMsVUFBVSxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7SUFDN0MsQ0FBQztJQUVELG9CQUFvQixDQUFDLFFBQVEsRUFBRSxVQUFVLENBQUMsQ0FBQztJQUMzQywwQkFBMEIsQ0FBQyxRQUFRLEVBQUUsVUFBVSxDQUFDLENBQUM7SUFDakQscUJBQXFCLENBQUMsUUFBUSxFQUFFLFVBQVUsQ0FBQyxDQUFDO0lBQzVDLHFCQUFxQixDQUFDLFFBQVEsRUFBRSxVQUFVLENBQUMsQ0FBQztBQUM5QyxDQUFDO0FBRUQsU0FBUyxvQkFBb0IsQ0FBQyxRQUFrQixFQUFFLFVBQWtCO0lBQ2xFLE1BQU0sVUFBVSxHQUFHLElBQUEsV0FBSSxFQUFDLFVBQVUsRUFBRSxXQUFXLENBQUMsQ0FBQztJQUNqRCxJQUFJLE9BQU8sR0FBRyw0QkFBNEIsQ0FBQztJQUUzQyxPQUFPLElBQUksY0FBYyxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRSxNQUFNLENBQUM7SUFFeEQsdUNBQXVDO0lBQ3ZDLE1BQU0sU0FBUyxHQU1WLEVBQUUsQ0FBQztJQUVSLE1BQU0sY0FBYyxHQUdmLEVBQUUsQ0FBQztJQUVSLEtBQUssTUFBTSxVQUFVLElBQUksUUFBUSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBQy9DLElBQUksVUFBVSxD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T0FBTyxVQUFVLEdBQUcsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLHlCQUF5QjtRQUN6RCxLQUFLLE9BQU8sQ0FBQztRQUNiLEtBQUssTUFBTSxDQUFDO1FBQ1osS0FBSyxRQUFRO1lBQ1gsT0FBTyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsNEJBQTRCO1FBQy9DO1lBQ0UsT0FBTyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsY0FBYztJQUNuQyxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGV4aXN0c1N5bmMsIG1rZGlyU3luYywgd3JpdGVGaWxlU3luYyB9IGZyb20gJ2ZzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcbmltcG9ydCB0eXBlIHsgTWFuaWZlc3QsIENhcGFiaWxpdHlEZXNjcmlwdG9yLCBSZXNvdXJjZUludGVudCB9IGZyb20gJy4vdHlwZXMnO1xuXG4vKipcbiAqIEdlbmVyYXRlIGFsbCByZXF1aXJlZCByZXBvcnRzIGFzIHNwZWNpZmllZCBpbiBkdS1wbGFuLm1kIFNlY3Rpb24gMjg6XG4gKiAtIHJvdXRlcy5tZCAtIFJvdXRlIG1hcHBpbmcgYW5kIGNvbmZsaWN0c1xuICogLSBjYXBhYmlsaXRpZXMubWQgLSBBbGwgZGlzY292ZXJlZCBjYXBhYmlsaXRpZXMgIFxuICogLSBpbnRlbnRzLm1kIC0gUmVzb3VyY2UgaW50ZW50cyBhbmQgSUFNIHBvbGljaWVzXG4gKiAtIGJ1bmRsZXMuanNvbiAtIEJ1bmRsZSBzaXplIGFuZCBkZXBlbmRlbmN5IG1ldHJpY3NcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlUmVwb3J0cyhtYW5pZmVzdDogTWFuaWZlc3QsIHJlcG9ydHNEaXI6IHN0cmluZyk6IHZvaWQge1xuICBjb25zb2xlLmxvZygnR2VuZXJhdGluZyByZXBvcnRzLi4uJyk7XG4gIFxuICBpZiAoIWV4aXN0c1N5bmMocmVwb3J0c0RpcikpIHtcbiAgICBta2RpclN5bmMocmVwb3J0c0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIH1cblxuICBnZW5lcmF0ZVJvdXRlc1JlcG9ydChtYW5pZmVzdCwgcmVwb3J0c0Rpcik7XG4gIGdlbmVyYXRlQ2FwYWJpbGl0aWVzUmVwb3J0KG1hbmlmZXN0LCByZXBvcnRzRGlyKTtcbiAgZ2VuZXJhdGVJbnRlbnRzUmVwb3J0KG1hbmlmZXN0LCByZXBvcnRzRGlyKTtcbiAgZ2VuZXJhdGVCdW5kbGVzUmVwb3J0KG1hbmlmZXN0LCByZXBvcnRzRGlyKTtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVSb3V0ZXNSZXBvcnQobWFuaWZlc3Q6IE1hbmlmZXN0LCByZXBvcnRzRGlyOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgcm91dGVzRmlsZSA9IGpvaW4ocmVwb3J0c0RpciwgJ3JvdXRlcy5tZCcpO1xuICBsZXQgY29udGVudCA9ICcjIFJvdXRlIE1hcHBpbmcgUmVwb3J0XFxuXFxuJztcbiAgXG4gIGNvbnRlbnQgKz0gYEdlbmVyYXRlZDogJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9XFxuXFxuYDtcbiAgXG4gIC8vIEV4dHJhY3QgYWxsIHJvdXRlcyBmcm9tIGNhcGFiaWxpdGllc1xuICBjb25zdCBhbGxSb3V0ZXM6IEFycmF5PHtcbiAgICBjYXBhYmlsaXR5OiBDYXBhYmlsaXR5RGVzY3JpcHRvcjtcbiAgICBtZXRob2Q6IHN0cmluZztcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAgZnVsbFBhdGg6IHN0cmluZztcbiAgICBhdXRob3JpemVyPzogYW55O1xuICB9PiA9IFtdO1xuXG4gIGNvbnN0IHJvdXRlQ29uZmxpY3RzOiBBcnJheTx7XG4gICAgc2lnbmF0dXJlOiBzdHJpbmc7XG4gICAgY2FwYWJpbGl0aWVzOiBDYXBhYmlsaXR5RGVzY3JpcHRvcltdO1xuICB9PiA9IFtdO1xuXG4gIGZvciAoY29uc3QgY2FwYWJpbGl0eSBvZiBtYW5pZmVzdC5jYXBhYmlsaXRpZXMpIHtcbiAgICBpZiAoY2FwYWJpbGl0eS5raW5kID09PSAnY29udHJvbGxlcicgJiYgY2FwYWJpbGl0eS5yb3V0aW5nPy5yb3V0ZXMpIHtcbiAgICAgIGNvbnN0IGJhc2VQYXRoID0gY2FwYWJpbGl0eS5yb3V0aW5nLmJhc2VQYXRoIHx8ICcnO1xuICAgICAgXG4gICAgICBmb3IgKGNvbnN0IHJvdXRlIG9mIGNhcGFiaWxpdHkucm91dGluZy5yb3V0ZXMpIHtcbiAgICAgICAgY29uc3QgZnVsbFBhdGggPSBgJHtiYXNlUGF0aH0ke3JvdXRlLnBhdGh9YC5yZXBsYWNlKC9cXC8rL2csICcvJyk7XG4gICAgICAgIGNvbnN0IHJvdXRlU2lnbmF0dXJlID0gYCR7cm91dGUubWV0aG9kfToke2Z1bGxQYXRofWA7XG4gICAgICAgIFxuICAgICAgICBhbGxSb3V0ZXMucHVzaCh7XG4gICAgICAgICAgY2FwYWJpbGl0eSxcbiAgICAgICAgICBtZXRob2Q6IHJvdXRlLm1ldGhvZCxcbiAgICAgICAgICBwYXRoOiByb3V0ZS5wYXRoLFxuICAgICAgICAgIGZ1bGxQYXRoLFxuICAgICAgICAgIGF1dGhvcml6ZXI6IHJvdXRlLmF1dGhvcml6ZXJcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQ2hlY2sgZm9yIGNvbmZsaWN0cyAtIG1vcmUgcm9idXN0IGRldGVjdGlvblxuICAgICAgICBjb25zdCBleGlzdGluZ0NvbmZsaWN0ID0gcm91dGVDb25mbGljdHMuZmluZChjID0+IGMuc2lnbmF0dXJlID09PSByb3V0ZVNpZ25hdHVyZSk7XG4gICAgICAgIGlmIChleGlzdGluZ0NvbmZsaWN0KSB7XG4gICAgICAgICAgLy8gQWRkIHRvIGV4aXN0aW5nIGNvbmZsaWN0IGlmIG5vdCBhbHJlYWR5IHRoZXJlXG4gICAgICAgICAgaWYgKCFleGlzdGluZ0NvbmZsaWN0LmNhcGFiaWxpdGllcy5zb21lKGNhcCA9PiBjYXAuaWQgPT09IGNhcGFiaWxpdHkuaWQpKSB7XG4gICAgICAgICAgICBleGlzdGluZ0NvbmZsaWN0LmNhcGFiaWxpdGllcy5wdXNoKGNhcGFiaWxpdHkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBMb29rIGZvciBvdGhlciByb3V0ZXMgd2l0aCBzYW1lIG1ldGhvZCBhbmQgcGF0aFxuICAgICAgICAgIGNvbnN0IGNvbmZsaWN0aW5nUm91dGUgPSBhbGxSb3V0ZXMuZmluZChyID0+IFxuICAgICAgICAgICAgciAhPT0gYWxsUm91dGVzW2FsbFJvdXRlcy5sZW5ndGggLSAxXSAmJiAvLyBOb3QgdGhlIGN1cnJlbnQgcm91dGUgd2UganVzdCBhZGRlZFxuICAgICAgICAgICAgci5tZXRob2QgPT09IHJvdXRlLm1ldGhvZCAmJiByLmZ1bGxQYXRoID09PSBmdWxsUGF0aFxuICAgICAgICAgICk7XG4gICAgICAgICAgXG4gICAgICAgICAgaWYgKGNvbmZsaWN0aW5nUm91dGUpIHtcbiAgICAgICAgICAgIHJvdXRlQ29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgICAgICBzaWduYXR1cmU6IHJvdXRlU2lnbmF0dXJlLFxuICAgICAgICAgICAgICBjYXBhYmlsaXRpZXM6IFtjb25mbGljdGluZ1JvdXRlLmNhcGFiaWxpdHksIGNhcGFiaWxpdHldXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBSb3V0ZSBjb25mbGljdHMgc2VjdGlvblxuICBpZiAocm91dGVDb25mbGljdHMubGVuZ3RoID4gMCkge1xuICAgIGNvbnRlbnQgKz0gJyMjIOKaoO+4jyBSb3V0ZSBDb25mbGljdHMgRGV0ZWN0ZWRcXG5cXG4nO1xuICAgIGZvciAoY29uc3QgY29uZmxpY3Qgb2Ygcm91dGVDb25mbGljdHMpIHtcbiAgICAgIGNvbnRlbnQgKz0gYCMjIyBcXGAke2NvbmZsaWN0LnNpZ25hdHVyZX1cXGBcXG5cXG5gO1xuICAgICAgY29udGVudCArPSAnQ29uZmxpY3RpbmcgY2FwYWJpbGl0aWVzOlxcbic7XG4gICAgICBmb3IgKGNvbnN0IGNhcCBvZiBjb25mbGljdC5jYXBhYmlsaXRpZXMpIHtcbiAgICAgICAgY29udGVudCArPSBgLSAqKiR7Y2FwLmV4cG9ydE5hbWV9KiogaW4gXFxgJHtjYXAuc291cmNlRmlsZX1cXGBcXG5gO1xuICAgICAgfVxuICAgICAgY29udGVudCArPSAnXFxuJztcbiAgICB9XG4gICAgY29udGVudCArPSAnXFxuJztcbiAgfSBlbHNlIHtcbiAgICBjb250ZW50ICs9ICcjIyDinIUgTm8gUm91dGUgQ29uZmxpY3RzXFxuXFxuJztcbiAgfVxuXG4gIC8vIEFsbCByb3V0ZXMgc2VjdGlvblxuICBjb250ZW50ICs9ICcjIyBBbGwgUm91dGVzXFxuXFxuJztcbiAgY29udGVudCArPSAnfCBNZXRob2QgfCBQYXRoIHwgQ29udHJvbGxlciB8IFNvdXJjZSBGaWxlIHwgQXV0aG9yaXplciB8XFxuJztcbiAgY29udGVudCArPSAnfC0tLS0tLS0tfC0tLS0tLXwtLS0tLS0tLS0tLS18LS0tLS0tLS0tLS0tLXwtLS0tLS0tLS0tLS18XFxuJztcblxuICAvLyBTb3J0IHJvdXRlcyBieSBtZXRob2QgYW5kIHBhdGhcbiAgYWxsUm91dGVzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBpZiAoYS5tZXRob2QgIT09IGIubWV0aG9kKSByZXR1cm4gYS5tZXRob2QubG9jYWxlQ29tcGFyZShiLm1ldGhvZCk7XG4gICAgcmV0dXJuIGEuZnVsbFBhdGgubG9jYWxlQ29tcGFyZShiLmZ1bGxQYXRoKTtcbiAgfSk7XG5cbiAgZm9yIChjb25zdCByb3V0ZSBvZiBhbGxSb3V0ZXMpIHtcbiAgICBjb25zdCBhdXRoSW5mbyA9IHJvdXRlLmF1dGhvcml6ZXIgXG4gICAgICA/ICh0eXBlb2Ygcm91dGUuYXV0aG9yaXplciA9PT0gJ3N0cmluZycgPyByb3V0ZS5hdXRob3JpemVyIDogcm91dGUuYXV0aG9yaXplci50eXBlIHx8ICdDdXN0b20nKVxuICAgICAgOiAnTm9uZSc7XG4gICAgXG4gICAgY29udGVudCArPSBgfCAke3JvdXRlLm1ldGhvZH0gfCBcXGAke3JvdXRlLmZ1bGxQYXRofVxcYCB8ICR7cm91dGUuY2FwYWJpbGl0eS5leHBvcnROYW1lfSB8IFxcYCR7cm91dGUuY2FwYWJpbGl0eS5zb3VyY2VGaWxlfVxcYCB8ICR7YXV0aEluZm99IHxcXG5gO1xuICB9XG5cbiAgY29udGVudCArPSBgXFxuKipUb3RhbCBSb3V0ZXM6KiogJHthbGxSb3V0ZXMubGVuZ3RofVxcbmA7XG4gIGNvbnRlbnQgKz0gYCoqUm91dGUgQ29uZmxpY3RzOioqICR7cm91dGVDb25mbGljdHMubGVuZ3RofVxcbmA7XG5cbiAgd3JpdGVGaWxlU3luYyhyb3V0ZXNGaWxlLCBjb250ZW50KTtcbiAgY29uc29sZS5sb2coYFJvdXRlcyByZXBvcnQgZ2VuZXJhdGVkOiAke3JvdXRlc0ZpbGV9YCk7XG59XG5cbmZ1bmN0aW9uIGdlbmVyYXRlQ2FwYWJpbGl0aWVzUmVwb3J0KG1hbmlmZXN0OiBNYW5pZmVzdCwgcmVwb3J0c0Rpcjogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IGNhcGFiaWxpdGllc0ZpbGUgPSBqb2luKHJlcG9ydHNEaXIsICdjYXBhYmlsaXRpZXMubWQnKTtcbiAgbGV0IGNvbnRlbnQgPSAnIyBDYXBhYmlsaXRpZXMgUmVwb3J0XFxuXFxuJztcbiAgXG4gIGNvbnRlbnQgKz0gYEdlbmVyYXRlZDogJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9XFxuXFxuYDtcblxuICAvLyBHcm91cCBjYXBhYmlsaXRpZXMgYnkga2luZFxuICBjb25zdCBjYXBhYmlsaXRpZXNCeUtpbmQgPSBtYW5pZmVzdC5jYXBhYmlsaXRpZXMucmVkdWNlKChhY2MsIGNhcCkgPT4ge1xuICAgIGlmICghYWNjW2NhcC5raW5kXSkgYWNjW2NhcC5raW5kXSA9IFtdO1xuICAgIGFjY1tjYXAua2luZF0ucHVzaChjYXApO1xuICAgIHJldHVybiBhY2M7XG4gIH0sIHt9IGFzIFJlY29yZDxzdHJpbmcsIENhcGFiaWxpdHlEZXNjcmlwdG9yW10+KTtcblxuICBjb250ZW50ICs9ICcjIyBTdW1tYXJ5XFxuXFxuJztcbiAgZm9yIChjb25zdCBba2luZCwgY2Fwc10gb2YgT2JqZWN0LmVudHJpZXMoY2FwYWJpbGl0aWVzQnlLaW5kKSkge1xuICAgIGNvbnRlbnQgKz0gYC0gKioke2tpbmR9Kio6ICR7Y2Fwcy5sZW5ndGh9IGNhcGFiaWxpdGllc1xcbmA7XG4gIH1cbiAgY29udGVudCArPSBgXFxuKipUb3RhbDoqKiAke21hbmlmZXN0LmNhcGFiaWxpdGllcy5sZW5ndGh9IGNhcGFiaWxpdGllc1xcblxcbmA7XG5cbiAgLy8gRGV0YWlsZWQgc2VjdGlvbnMgZm9yIGVhY2gga2luZFxuICBmb3IgKGNvbnN0IFtraW5kLCBjYXBzXSBvZiBPYmplY3QuZW50cmllcyhjYXBhYmlsaXRpZXNCeUtpbmQpKSB7XG4gICAgY29udGVudCArPSBgIyMgJHtraW5kLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsga2luZC5zbGljZSgxKX0gQ2FwYWJpbGl0aWVzXFxuXFxuYDtcbiAgICBcbiAgICBjb250ZW50ICs9ICd8IE5hbWUgfCBTb3VyY2UgRmlsZSB8IFRhZ3MgfCBSZXNvdXJjZSBJbnRlbnRzIHxcXG4nO1xuICAgIGNvbnRlbnQgKz0gJ3wtLS0tLS18LS0tLS0tLS0tLS0tLXwtLS0tLS18LS0tLS0tLS0tLS0tLS0tLS0tfFxcbic7XG5cbiAgICBmb3IgKGNvbnN0IGNhcCBvZiBjYXBzKSB7XG4gICAgICBjb25zdCB0YWdzID0gY2FwLnRhZ3M/LmpvaW4oJywgJykgfHwgJ05vbmUnO1xuICAgICAgY29uc3QgaW50ZW50cyA9IGNhcC5yZXF1aXJlcz8ucmVzb3VyY2VJbnRlbnRzPy5sZW5ndGggfHwgMDtcbiAgICAgIGNvbnRlbnQgKz0gYHwgJHtjYXAuZXhwb3J0TmFtZX0gfCBcXGAke2NhcC5zb3VyY2VGaWxlfVxcYCB8ICR7dGFnc30gfCAke2ludGVudHN9IHxcXG5gO1xuICAgIH1cbiAgICBjb250ZW50ICs9ICdcXG4nO1xuICB9XG5cbiAgLy8gTW9kdWxlIGJyZWFrZG93blxuICBjb250ZW50ICs9ICcjIyBNb2R1bGUgQnJlYWtkb3duXFxuXFxuJztcbiAgY29uc3QgY2Fwc0J5TW9kdWxlID0gbWFuaWZlc3QuY2FwYWJpbGl0aWVzLnJlZHVjZSgoYWNjLCBjYXApID0+IHtcbiAgICAvLyBFeHRyYWN0IG1vZHVsZSBmcm9tIHNvdXJjZSBmaWxlIHBhdGhcbiAgICBjb25zdCBtb2R1bGVOYW1lID0gY2FwLnNvdXJjZUZpbGUuc3BsaXQoJy8nKVsxXSB8fCAndW5rbm93bic7XG4gICAgaWYgKCFhY2NbbW9kdWxlTmFtZV0pIGFjY1ttb2R1bGVOYW1lXSA9IFtdO1xuICAgIGFjY1ttb2R1bGVOYW1lXS5wdXNoKGNhcCk7XG4gICAgcmV0dXJuIGFjYztcbiAgfSwge30gYXMgUmVjb3JkPHN0cmluZywgQ2FwYWJpbGl0eURlc2NyaXB0b3JbXT4pO1xuXG4gIGZvciAoY29uc3QgW21vZHVsZSwgY2Fwc10gb2YgT2JqZWN0LmVudHJpZXMoY2Fwc0J5TW9kdWxlKSkge1xuICAgIGNvbnRlbnQgKz0gYCMjIyAke21vZHVsZX1cXG5cXG5gO1xuICAgIGZvciAoY29uc3QgY2FwIG9mIGNhcHMpIHtcbiAgICAgIGNvbnRlbnQgKz0gYC0gKioke2NhcC5leHBvcnROYW1lfSoqICgke2NhcC5raW5kfSlcXG5gO1xuICAgIH1cbiAgICBjb250ZW50ICs9ICdcXG4nO1xuICB9XG5cbiAgd3JpdGVGaWxlU3luYyhjYXBhYmlsaXRpZXNGaWxlLCBjb250ZW50KTtcbiAgY29uc29sZS5sb2coYENhcGFiaWxpdGllcyByZXBvcnQgZ2VuZXJhdGVkOiAke2NhcGFiaWxpdGllc0ZpbGV9YCk7XG59XG5cbmZ1bmN0aW9uIGdlbmVyYXRlSW50ZW50c1JlcG9ydChtYW5pZmVzdDogTWFuaWZlc3QsIHJlcG9ydHNEaXI6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBpbnRlbnRzRmlsZSA9IGpvaW4ocmVwb3J0c0RpciwgJ2ludGVudHMubWQnKTtcbiAgbGV0IGNvbnRlbnQgPSAnIyBSZXNvdXJjZSBJbnRlbnRzIFJlcG9ydFxcblxcbic7XG4gIFxuICBjb250ZW50ICs9IGBHZW5lcmF0ZWQ6ICR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpfVxcblxcbmA7XG5cbiAgY29udGVudCArPSAnIyMgU3VtbWFyeVxcblxcbic7XG4gIFxuICAvLyBHcm91cCBpbnRlbnRzIGJ5IGtpbmRcbiAgY29uc3QgaW50ZW50c0J5S2luZCA9IG1hbmlmZXN0LnJlc291cmNlSW50ZW50cy5yZWR1Y2UoKGFjYywgaW50ZW50KSA9PiB7XG4gICAgaWYgKCFhY2NbaW50ZW50LmtpbmRdKSBhY2NbaW50ZW50LmtpbmRdID0gW107XG4gICAgYWNjW2ludGVudC5raW5kXS5wdXNoKGludGVudCk7XG4gICAgcmV0dXJuIGFjYztcbiAgfSwge30gYXMgUmVjb3JkPHN0cmluZywgUmVzb3VyY2VJbnRlbnRbXT4pO1xuXG4gIGZvciAoY29uc3QgW2tpbmQsIGludGVudHNdIG9mIE9iamVjdC5lbnRyaWVzKGludGVudHNCeUtpbmQpKSB7XG4gICAgY29udGVudCArPSBgLSAqKiR7a2luZH0qKjogJHtpbnRlbnRzLmxlbmd0aH0gaW50ZW50c1xcbmA7XG4gIH1cbiAgY29udGVudCArPSBgXFxuKipUb3RhbDoqKiAke21hbmlmZXN0LnJlc291cmNlSW50ZW50cy5sZW5ndGh9IHJlc291cmNlIGludGVudHNcXG5cXG5gO1xuXG4gIC8vIERldGFpbGVkIGJyZWFrZG93blxuICBjb250ZW50ICs9ICcjIyBSZXNvdXJjZSBJbnRlbnRzIGJ5IFR5cGVcXG5cXG4nO1xuICBcbiAgZm9yIChjb25zdCBba2luZCwgaW50ZW50c10gb2YgT2JqZWN0LmVudHJpZXMoaW50ZW50c0J5S2luZCkpIHtcbiAgICBjb250ZW50ICs9IGAjIyMgJHtraW5kLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsga2luZC5zbGljZSgxKX0gUmVzb3VyY2VzXFxuXFxuYDtcbiAgICBcbiAgICBjb250ZW50ICs9ICd8IFJlc291cmNlIE5hbWUgfCBQZXJtaXNzaW9ucyB8IFNjb3BlIHxcXG4nO1xuICAgIGNvbnRlbnQgKz0gJ3wtLS0tLS0tLS0tLS0tLS18LS0tLS0tLS0tLS0tLXwtLS0tLS0tfFxcbic7XG5cbiAgICBmb3IgKGNvbnN0IGludGVudCBvZiBpbnRlbnRzKSB7XG4gICAgICBjb25zdCBwZXJtaXNzaW9ucyA9IGludGVudC5wZXJtaXNzaW9ucy5qb2luKCcsICcpO1xuICAgICAgY29uc3Qgc2NvcGUgPSBpbnRlbnQuc2NvcGUgPyBcbiAgICAgICAgKGludGVudC5zY29wZS5pbmRleCA/IGBJbmRleDogJHtpbnRlbnQuc2NvcGUuaW5kZXh9YCA6IFxuICAgICAgICAgaW50ZW50LnNjb3BlLnByZWZpeCA/IGBQcmVmaXg6ICR7aW50ZW50LnNjb3BlLnByZWZpeH1gIDogJ05vbmUnKSA6ICdOb25lJztcbiAgICAgIGNvbnRlbnQgKz0gYHwgJHtpbnRlbnQubmFtZX0gfCAke3Blcm1pc3Npb25zfSB8ICR7c2NvcGV9IHxcXG5gO1xuICAgIH1cbiAgICBjb250ZW50ICs9ICdcXG4nO1xuICB9XG5cbiAgLy8gQ2FwYWJpbGl0eS1sZXZlbCBpbnRlbnRzXG4gIGNvbnRlbnQgKz0gJyMjIENhcGFiaWxpdGllcyB3aXRoIFJlc291cmNlIEludGVudHNcXG5cXG4nO1xuICBcbiAgY29uc3QgY2Fwc1dpdGhJbnRlbnRzID0gbWFuaWZlc3QuY2FwYWJpbGl0aWVzLmZpbHRlcihjYXAgPT4gXG4gICAgY2FwLnJlcXVpcmVzPy5yZXNvdXJjZUludGVudHMgJiYgY2FwLnJlcXVpcmVzLnJlc291cmNlSW50ZW50cy5sZW5ndGggPiAwXG4gICk7XG5cbiAgaWYgKGNhcHNXaXRoSW50ZW50cy5sZW5ndGggPiAwKSB7XG4gICAgY29udGVudCArPSAnfCBDYXBhYmlsaXR5IHwgS2luZCB8IEludGVudHMgfFxcbic7XG4gICAgY29udGVudCArPSAnfC0tLS0tLS0tLS0tLXwtLS0tLS18LS0tLS0tLS18XFxuJztcblxuICAgIGZvciAoY29uc3QgY2FwIG9mIGNhcHNXaXRoSW50ZW50cykge1xuICAgICAgY29uc3QgaW50ZW50c0xpc3QgPSBjYXAucmVxdWlyZXMhLnJlc291cmNlSW50ZW50cyEubWFwKGludGVudCA9PiBcbiAgICAgICAgYCR7aW50ZW50LmtpbmR9OiR7aW50ZW50Lm5hbWV9ICgke2ludGVudC5wZXJtaXNzaW9ucy5qb2luKCcsJyl9KWBcbiAgICAgICkuam9pbignPGJyPicpO1xuICAgICAgY29udGVudCArPSBgfCAke2NhcC5leHBvcnROYW1lfSB8ICR7Y2FwLmtpbmR9IHwgJHtpbnRlbnRzTGlzdH0gfFxcbmA7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGNvbnRlbnQgKz0gJypObyBjYXBhYmlsaXRpZXMgaGF2ZSBleHBsaWNpdCByZXNvdXJjZSBpbnRlbnRzIGRlY2xhcmVkLipcXG4nO1xuICB9XG5cbiAgY29udGVudCArPSAnXFxuIyMgSUFNIFBvbGljeSBSZWNvbW1lbmRhdGlvbnNcXG5cXG4nO1xuICBjb250ZW50ICs9ICdCYXNlZCBvbiB0aGUgcmVzb3VyY2UgaW50ZW50cywgdGhlIGZvbGxvd2luZyBJQU0gcG9saWNpZXMgc2hvdWxkIGJlIGdlbmVyYXRlZDpcXG5cXG4nO1xuXG4gIGZvciAoY29uc3QgW2tpbmQsIGludGVudHNdIG9mIE9iamVjdC5lbnRyaWVzKGludGVudHNCeUtpbmQpKSB7XG4gICAgY29udGVudCArPSBgIyMjICR7a2luZH0gUG9saWNpZXNcXG5cXG5gO1xuICAgIGNvbnRlbnQgKz0gJ2BgYGpzb25cXG4nO1xuICAgIGNvbnRlbnQgKz0gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxuICAgICAgU3RhdGVtZW50OiBpbnRlbnRzLm1hcChpbnRlbnQgPT4gKHtcbiAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICBBY3Rpb246IGludGVudC5wZXJtaXNzaW9ucy5tYXAocGVybSA9PiBgJHtraW5kfToke3Blcm19YCksXG4gICAgICAgIFJlc291cmNlOiBpbnRlbnQuc2NvcGU/LnByZWZpeCBcbiAgICAgICAgICA/IGBhcm46YXdzOiR7a2luZH06KjoqOiR7aW50ZW50Lm5hbWV9JHtpbnRlbnQuc2NvcGUucHJlZml4fSpgXG4gICAgICAgICAgOiBgYXJuOmF3czoke2tpbmR9Oio6Kjoke2ludGVudC5uYW1lfWBcbiAgICAgIH0pKVxuICAgIH0sIG51bGwsIDIpO1xuICAgIGNvbnRlbnQgKz0gJ1xcbmBgYFxcblxcbic7XG4gIH1cblxuICB3cml0ZUZpbGVTeW5jKGludGVudHNGaWxlLCBjb250ZW50KTtcbiAgY29uc29sZS5sb2coYEludGVudHMgcmVwb3J0IGdlbmVyYXRlZDogJHtpbnRlbnRzRmlsZX1gKTtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVCdW5kbGVzUmVwb3J0KG1hbmlmZXN0OiBNYW5pZmVzdCwgcmVwb3J0c0Rpcjogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IGJ1bmRsZXNGaWxlID0gam9pbihyZXBvcnRzRGlyLCAnYnVuZGxlcy5qc29uJyk7XG4gIFxuICAvLyBHZW5lcmF0ZSBidW5kbGUgbWV0cmljcyBmb3IgZWFjaCBkZXBsb3ltZW50IHVuaXRcbiAgY29uc3QgYnVuZGxlUmVwb3J0ID0ge1xuICAgIGdlbmVyYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgZGVwbG95bWVudFVuaXRzOiBtYW5pZmVzdC5kZXBsb3ltZW50VW5pdHMubWFwKGR1ID0+ICh7XG4gICAgICBuYW1lOiBkdS5uYW1lLFxuICAgICAga2luZDogZHUua2luZCxcbiAgICAgIGNhcGFiaWxpdGllczogbWFuaWZlc3QuY2FwYWJpbGl0aWVzLmZpbHRlcihjYXAgPT4ge1xuICAgICAgICAvLyBTaW1wbGUgbWF0Y2hpbmcgLSBpbiBwcmFjdGljZSB0aGlzIHdvdWxkIGJlIG1vcmUgc29waGlzdGljYXRlZFxuICAgICAgICByZXR1cm4gZHUuaW5jbHVkZT8uY2FwYWJpbGl0aWVzPy5zb21lKGluY2x1ZGVDYXAgPT4gXG4gICAgICAgICAgdHlwZW9mIGluY2x1ZGVDYXAgPT09ICdzdHJpbmcnID8gaW5jbHVkZUNhcCA9PT0gY2FwLmlkIDpcbiAgICAgICAgICBpbmNsdWRlQ2FwLmtpbmQgPT09IGNhcC5raW5kXG4gICAgICAgICkgPz8gdHJ1ZTsgLy8gRGVmYXVsdCB0byBpbmNsdWRlIGFsbCBpZiBubyBzcGVjaWZpYyBpbmNsdWRlIHJ1bGVzXG4gICAgICB9KS5tYXAoY2FwID0+ICh7XG4gICAgICAgIGlkOiBjYXAuaWQsXG4gICAgICAgIGtpbmQ6IGNhcC5raW5kLFxuICAgICAgICBzb3VyY2VGaWxlOiBjYXAuc291cmNlRmlsZSxcbiAgICAgICAgZXN0aW1hdGVkU2l6ZTogZXN0aW1hdGVDYXBhYmlsaXR5U2l6ZShjYXApXG4gICAgICB9KSksXG4gICAgICBlc3RpbWF0ZWRCdW5kbGVTaXplOiAwLCAvLyBXaWxsIGJlIGNhbGN1bGF0ZWRcbiAgICAgIGRlcGVuZGVuY2llczogW10gYXMgc3RyaW5nW10sXG4gICAgICBzaGFyZWREZXBlbmRlbmNpZXM6IFtdIGFzIHN0cmluZ1tdXG4gICAgfSkpLFxuICAgIHNoYXJlZExheWVyczoge1xuICAgICAgdmVuZG9yOiB7XG4gICAgICAgIGVzdGltYXRlZFNpemU6IDEwMjQgKiAxMDI0LCAvLyAxTUIgZXN0aW1hdGVcbiAgICAgICAgcGFja2FnZXM6IFsnQGF3cy1zZGsnLCAnQHRlbjI0Z3JvdXAvZncyNCcsICdlbGVjdHJvZGInXVxuICAgICAgfVxuICAgIH0sXG4gICAgcmVjb21tZW5kYXRpb25zOiBbXSBhcyBzdHJpbmdbXVxuICB9O1xuXG4gIC8vIENhbGN1bGF0ZSBidW5kbGUgc2l6ZXMgYW5kIGFkZCByZWNvbW1lbmRhdGlvbnNcbiAgZm9yIChjb25zdCBkdSBvZiBidW5kbGVSZXBvcnQuZGVwbG95bWVudFVuaXRzKSB7XG4gICAgZHUuZXN0aW1hdGVkQnVuZGxlU2l6ZSA9IGR1LmNhcGFiaWxpdGllcy5yZWR1Y2UoKHN1bSwgY2FwKSA9PiBzdW0gKyBjYXAuZXN0aW1hdGVkU2l6ZSwgMCk7XG4gICAgXG4gICAgaWYgKGR1LmVzdGltYXRlZEJ1bmRsZVNpemUgPiAxMCAqIDEwMjQgKiAxMDI0KSB7IC8vID4gMTBNQlxuICAgICAgYnVuZGxlUmVwb3J0LnJlY29tbWVuZGF0aW9ucy5wdXNoKFxuICAgICAgICBgJHtkdS5uYW1lfTogQnVuZGxlIHNpemUgKCR7KGR1LmVzdGltYXRlZEJ1bmRsZVNpemUgLyAxMDI0IC8gMTAyNCkudG9GaXhlZCgxKX1NQikgZXhjZWVkcyAxME1CIHJlY29tbWVuZGF0aW9uYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAoZHUuY2FwYWJpbGl0aWVzLmxlbmd0aCA+IDIwKSB7XG4gICAgICBidW5kbGVSZXBvcnQucmVjb21tZW5kYXRpb25zLnB1c2goXG4gICAgICAgIGAke2R1Lm5hbWV9OiBIaWdoIGNhcGFiaWxpdHkgY291bnQgKCR7ZHUuY2FwYWJpbGl0aWVzLmxlbmd0aH0pIG1heSBpbXBhY3QgY29sZCBzdGFydGBcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgd3JpdGVGaWxlU3luYyhidW5kbGVzRmlsZSwgSlNPTi5zdHJpbmdpZnkoYnVuZGxlUmVwb3J0LCBudWxsLCAyKSk7XG4gIGNvbnNvbGUubG9nKGBCdW5kbGVzIHJlcG9ydCBnZW5lcmF0ZWQ6ICR7YnVuZGxlc0ZpbGV9YCk7XG59XG5cbmZ1bmN0aW9uIGVzdGltYXRlQ2FwYWJpbGl0eVNpemUoY2FwYWJpbGl0eTogQ2FwYWJpbGl0eURlc2NyaXB0b3IpOiBudW1iZXIge1xuICAvLyBTaW1wbGUgc2l6ZSBlc3RpbWF0aW9uIGJhc2VkIG9uIGNhcGFiaWxpdHkgdHlwZVxuICBzd2l0Y2ggKGNhcGFiaWxpdHkua2luZCkge1xuICAgIGNhc2UgJ2NvbnRyb2xsZXInOlxuICAgICAgLy8gQ29udHJvbGxlcnMgdHlwaWNhbGx5IGhhdmUgbW9yZSBjb2RlXG4gICAgICBjb25zdCByb3V0ZUNvdW50ID0gY2FwYWJpbGl0eS5yb3V0aW5nPy5yb3V0ZXM/Lmxlbmd0aCB8fCAxO1xuICAgICAgcmV0dXJuIHJvdXRlQ291bnQgKiA1ICogMTAyNDsgLy8gNUtCIHBlciByb3V0ZSBlc3RpbWF0ZVxuICAgIGNhc2UgJ3F1ZXVlJzpcbiAgICBjYXNlICd0YXNrJzpcbiAgICBjYXNlICdzdHJlYW0nOlxuICAgICAgcmV0dXJuIDIgKiAxMDI0OyAvLyAyS0IgZXN0aW1hdGUgZm9yIGhhbmRsZXJzXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiAxICogMTAyNDsgLy8gMUtCIGRlZmF1bHRcbiAgfVxufVxuIl19