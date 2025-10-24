"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDUBootstraps = generateDUBootstraps;
const fs_1 = require("fs");
const path_1 = require("path");
const ts_morph_1 = require("ts-morph");
const real_dependency_analysis_1 = require("./real-dependency-analysis");
function generateDUBootstraps(manifest, mapping, options) {
    const { outputDir, rootDir } = options;
    if (!(0, fs_1.existsSync)(outputDir)) {
        (0, fs_1.mkdirSync)(outputDir, { recursive: true });
    }
    // Create ts-morph project for AST-based code generation
    const project = new ts_morph_1.Project({
        useInMemoryFileSystem: false,
        skipAddingFilesFromTsConfig: true,
        compilerOptions: {
            target: 99, // ESNext
            module: 99, // ESNext
            strict: true,
        }
    });
    for (const du of mapping.deploymentUnits) {
        const capabilities = getCapabilitiesForDU(manifest.capabilities, du, mapping.capabilityToDU);
        const filePath = (0, path_1.join)(outputDir, `du-${du.name}.bootstrap.ts`);
        // Generate bootstrap file using ts-morph AST
        generateBootstrapFileWithTsMorph(project, du, capabilities, manifest, filePath, rootDir);
    }
}
function getCapabilitiesForDU(allCapabilities, du, capabilityToDU) {
    return allCapabilities.filter(cap => capabilityToDU.get(cap.id) === du.name);
}
function generateBootstrapFileWithTsMorph(project, du, capabilities, manifest, filePath, rootDir) {
    // Analyze dependencies for this DU using real framework patterns
    const dependencies = (0, real_dependency_analysis_1.analyzeRealDUDependencies)(du.name, capabilities, manifest, rootDir);
    // Create or get the source file
    const sourceFile = project.createSourceFile(filePath, "", { overwrite: true });
    // Add file header comment
    sourceFile.insertText(0, `// Generated DU bootstrap for ${du.name}\n// DO NOT EDIT - This file is auto-generated\n\n`);
    // Add imports
    addImports(sourceFile, dependencies, manifest, rootDir, filePath);
    // Add setupDI function
    addSetupDIFunction(sourceFile, dependencies);
    // Add handler function
    addHandlerFunction(sourceFile, du, dependencies);
    // Save the file with proper formatting
    sourceFile.saveSync();
}
function addImports(sourceFile, dependencies, manifest, rootDir, bootstrapFilePath) {
    // Core framework imports
    const frameworkImports = ['DIContainer', 'registerEntitySchema'];
    sourceFile.addImportDeclaration({
        moduleSpecifier: '@ten24group/fw24',
        namedImports: frameworkImports
    });
    // AWS Lambda types
    sourceFile.addImportDeclaration({
        moduleSpecifier: 'aws-lambda',
        namedImports: [
            { name: 'APIGatewayEvent', isTypeOnly: true },
            { name: 'APIGatewayProxyResult', isTypeOnly: true },
            { name: 'Context', isTypeOnly: true }
        ]
    });
    // Import modules
    for (const module of dependencies.modules) {
        if (module.importPath.startsWith('@')) {
            // External module
            sourceFile.addImportDeclaration({
                moduleSpecifier: module.importPath,
                namedImports: [module.className]
            });
        }
        else {
            // Local module - calculate relative path
            const relativePath = calculateRelativeImportPath(bootstrapFilePath, (0, path_1.join)(rootDir, module.importPath));
            sourceFile.addImportDeclaration({
                moduleSpecifier: relativePath,
                namedImports: [module.className]
            });
        }
    }
    // Import entity schema factories
    for (const entity of dependencies.entities) {
        const relativePath = calculateRelativeImportPath(bootstrapFilePath, (0, path_1.join)(rootDir, entity.schemaImportPath));
        sourceFile.addImportDeclaration({
            moduleSpecifier: relativePath,
            namedImports: [entity.schemaFactory]
        });
    }
    // Import controllers
    for (const controller of dependencies.controllers) {
        const relativePath = calculateRelativeImportPath(bootstrapFilePath, (0, path_1.join)(rootDir, controller.importPath));
        sourceFile.addImportDeclaration({
            moduleSpecifier: relativePath,
            namedImports: [controller.className]
        });
    }
    // Import services from manifest modules
    for (const manifestModule of manifest.modules || []) {
        if (manifestModule.runtime?.providers) {
            const serviceClassNames = manifestModule.runtime.providers
                .filter(p => p.kind === 'service' && p.useClassToken)
                .map(p => p.useClassToken);
            if (serviceClassNames.length > 0) {
                // Find service imports - they're typically in src/services/
                for (const serviceName of serviceClassNames) {
                    // Convert service class name to likely file path
                    const servicePath = `src/services/${serviceName.replace('Service', '').toLowerCase()}`;
                    const relativePath = calculateRelativeImportPath(bootstrapFilePath, (0, path_1.join)(rootDir, servicePath));
                    sourceFile.addImportDeclaration({
                        moduleSpecifier: relativePath,
                        namedImports: [serviceName]
                    });
                }
            }
        }
    }
}
function addSetupDIFunction(sourceFile, dependencies) {
    const setupDIFunction = sourceFile.addFunction({
        name: 'setupDI',
        returnType: 'DIContainer',
        statements: [
            // Create container
            'const container = new DIContainer();',
            '',
            // Add all DI registrations
            ...dependencies.diRegistrations.map(reg => reg.code),
            '',
            'return container;'
        ]
    });
}
function addHandlerFunction(sourceFile, du, dependencies) {
    if (du.kind === 'api') {
        addAPIHandler(sourceFile, dependencies);
    }
    else {
        addWorkerHandler(sourceFile, dependencies);
    }
}
function addAPIHandler(sourceFile, dependencies) {
    const routingStatements = dependencies.controllers.flatMap(controller => [
        `if (path.startsWith('${controller.basePath}')) {`,
        `  const controllerInstance = container.resolve('${controller.className}') as any;`,
        `  return await controllerInstance.LambdaHandler(event, context);`,
        `}`
    ]);
    sourceFile.addFunction({
        name: 'handler',
        isExported: true,
        isAsync: true,
        parameters: [
            { name: 'event', type: 'APIGatewayEvent' },
            { name: 'context', type: 'Context' }
        ],
        returnType: 'Promise<APIGatewayProxyResult>',
        statements: [
            'const container = setupDI();',
            'const path = event.path || "/";',
            '',
            '// Route to appropriate controller based on path',
            ...routingStatements,
            '',
            '// Default 404 response',
            'return {',
            '  statusCode: 404,',
            '  body: JSON.stringify({ error: "Not Found", path })',
            '};'
        ]
    });
}
function addWorkerHandler(sourceFile, dependencies) {
    const firstController = dependencies.controllers[0];
    sourceFile.addFunction({
        name: 'handler',
        isExported: true,
        isAsync: true,
        parameters: [
            { name: 'event', type: 'any' },
            { name: 'context', type: 'any' }
        ],
        statements: [
            'const container = setupDI();',
            `const handler = container.resolve('${firstController.className}');`,
            '',
            'return handler.handle(event, context);'
        ]
    });
}
function calculateRelativeImportPath(fromFile, toFile) {
    // Get the directory of the from file
    const fromDir = fromFile.replace(/[^/]+$/, '');
    // Remove .ts extension from target file
    const cleanToFile = toFile.replace(/\.ts$/, '');
    // Calculate relative path
    let relativePath = (0, path_1.relative)(fromDir, cleanToFile);
    // Ensure relative paths start with './' or '../'
    if (!relativePath.startsWith('.')) {
        relativePath = './' + relativePath;
    }
    return relativePath;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm9vdHN0cmFwLWdlbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9tYW5pZmVzdC9ib290c3RyYXAtZ2VuLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBWUEsb0RBNkJDO0FBekNELDJCQUEyQztBQUMzQywrQkFBc0M7QUFDdEMsdUNBQTJGO0FBRzNGLHlFQUEyRjtBQU8zRixTQUFnQixvQkFBb0IsQ0FDbEMsUUFBa0IsRUFDbEIsT0FBd0IsRUFDeEIsT0FBNEI7SUFFNUIsTUFBTSxFQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFFdkMsSUFBSSxDQUFDLElBQUEsZUFBVSxFQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7UUFDM0IsSUFBQSxjQUFTLEVBQUMsU0FBUyxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7SUFDNUMsQ0FBQztJQUVELHdEQUF3RDtJQUN4RCxNQUFNLE9BQU8sR0FBRyxJQUFJLGtCQUFPLENBQUM7UUFDMUIscUJBQXFCLEVBQUUsS0FBSztRQUM1QiwyQkFBMkIsRUFBRSxJQUFJO1FBQ2pDLGVBQWUsRUFBRTtZQUNmLE1BQU0sRUFBRSxFQUFFLEVBQUUsU0FBUztZQUNyQixNQUFNLEVBQUUsRUFBRSxFQUFFLFNBQVM7WUFDckIsTUFBTSxFQUFFLElBQUk7U0FDYjtLQUNGLENBQUMsQ0FBQztJQUVILEtBQUssTUFBTSxFQUFFLElBQUksT0FBTyxDQUFDLGVBQWUsRUFBRSxDQUFDO1FBQ3pDLE1BQU0sWUFBWSxHQUFHLG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxZQUFZLEVBQUUsRUFBRSxFQUFFLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUM3RixNQUFNLFFBQVEsR0FBRyxJQUFBLFdBQUksRUFBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLENBQUMsSUFBSSxlQUFlLENBQUMsQ0FBQztRQUUvRCw2Q0FBNkM7UUFDN0MsZ0NBQWdDLENBQUMsT0FBTyxF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QUFDLENBQUMsQ0FBQztJQUVwRCxVQUFVLENBQUMsV0FBVyxDQUFDO1FBQ3JCLElBQUksRUFBRSxTQUFTO1FBQ2YsVUFBVSxFQUFFLElBQUk7UUFDaEIsT0FBTyxFQUFFLElBQUk7UUFDYixVQUFVLEVBQUU7WUFDVixFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUM5QixFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRTtTQUNqQztRQUNELFVBQVUsRUFBRTtZQUNWLDhCQUE4QjtZQUM5QixzQ0FBc0MsZUFBZSxDQUFDLFNBQVMsS0FBSztZQUNwRSxFQUFFO1lBQ0Ysd0NBQXdDO1NBQ3pDO0tBQ0YsQ0FBQyxDQUFDO0FBQ0wsQ0FBQztBQUVELFNBQVMsMkJBQTJCLENBQUMsUUFBZ0IsRUFBRSxNQUFjO0lBQ25FLHFDQUFxQztJQUNyQyxNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUUvQyx3Q0FBd0M7SUFDeEMsTUFBTSxXQUFXLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFFaEQsMEJBQTBCO0lBQzFCLElBQUksWUFBWSxHQUFHLElBQUEsZUFBUSxFQUFDLE9BQU8sRUFBRSxXQUFXLENBQUMsQ0FBQztJQUVsRCxpREFBaUQ7SUFDakQsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNsQyxZQUFZLEdBQUcsSUFBSSxHQUFHLFlBQVksQ0FBQztJQUNyQyxDQUFDO0lBRUQsT0FBTyxZQUFZLENBQUM7QUFDdEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IG1rZGlyU3luYywgZXhpc3RzU3luYyB9IGZyb20gJ2ZzJztcbmltcG9ydCB7IGpvaW4sIHJlbGF0aXZlIH0gZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBQcm9qZWN0LCBTb3VyY2VGaWxlLCBTeW50YXhLaW5kLCBWYXJpYWJsZURlY2xhcmF0aW9uS2luZCwgU2NvcGUgfSBmcm9tICd0cy1tb3JwaCc7XG5pbXBvcnQgeyBDYXBhYmlsaXR5RGVzY3JpcHRvciwgRGVwbG95bWVudFVuaXREZXNjcmlwdG9yLCBNYW5pZmVzdCB9IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgRFVNYXBwaW5nUmVzdWx0IH0gZnJvbSAnLi9kdS1tYXBwaW5nJztcbmltcG9ydCB7IGFuYWx5emVSZWFsRFVEZXBlbmRlbmNpZXMsIFJlYWxEVURlcGVuZGVuY2llcyB9IGZyb20gJy4vcmVhbC1kZXBlbmRlbmN5LWFuYWx5c2lzJztcblxuZXhwb3J0IGludGVyZmFjZSBCb290c3RyYXBHZW5PcHRpb25zIHtcbiAgb3V0cHV0RGlyOiBzdHJpbmc7IC8vIC5mdzI0Ly5nZW5lcmF0ZWRcbiAgcm9vdERpcjogc3RyaW5nOyAgIC8vIHByb2plY3Qgcm9vdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVEVUJvb3RzdHJhcHMoXG4gIG1hbmlmZXN0OiBNYW5pZmVzdCwgXG4gIG1hcHBpbmc6IERVTWFwcGluZ1Jlc3VsdCwgXG4gIG9wdGlvbnM6IEJvb3RzdHJhcEdlbk9wdGlvbnNcbik6IHZvaWQge1xuICBjb25zdCB7IG91dHB1dERpciwgcm9vdERpciB9ID0gb3B0aW9ucztcbiAgXG4gIGlmICghZXhpc3RzU3luYyhvdXRwdXREaXIpKSB7XG4gICAgbWtkaXJTeW5jKG91dHB1dERpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIH1cblxuICAvLyBDcmVhdGUgdHMtbW9ycGggcHJvamVjdCBmb3IgQVNULWJhc2VkIGNvZGUgZ2VuZXJhdGlvblxuICBjb25zdCBwcm9qZWN0ID0gbmV3IFByb2plY3Qoe1xuICAgIHVzZUluTWVtb3J5RmlsZVN5c3RlbTogZmFsc2UsXG4gICAgc2tpcEFkZGluZ0ZpbGVzRnJvbVRzQ29uZmlnOiB0cnVlLFxuICAgIGNvbXBpbGVyT3B0aW9uczoge1xuICAgICAgdGFyZ2V0OiA5OSwgLy8gRVNOZXh0XG4gICAgICBtb2R1bGU6IDk5LCAvLyBFU05leHRcbiAgICAgIHN0cmljdDogdHJ1ZSxcbiAgICB9XG4gIH0pO1xuXG4gIGZvciAoY29uc3QgZHUgb2YgbWFwcGluZy5kZXBsb3ltZW50VW5pdHMpIHtcbiAgICBjb25zdCBjYXBhYmlsaXRpZXMgPSBnZXRDYXBhYmlsaXRpZXNGb3JEVShtYW5pZmVzdC5jYXBhYmlsaXRpZXMsIGR1LCBtYXBwaW5nLmNhcGFiaWxpdHlUb0RVKTtcbiAgICBjb25zdCBmaWxlUGF0aCA9IGpvaW4ob3V0cHV0RGlyLCBgZHUtJHtkdS5uYW1lfS5ib290c3RyYXAudHNgKTtcbiAgICBcbiAgICAvLyBHZW5lcmF0ZSBib290c3RyYXAgZmlsZSB1c2luZyB0cy1tb3JwaCBBU1RcbiAgICBnZW5lcmF0ZUJvb3RzdHJhcEZpbGVXaXRoVHNNb3JwaChwcm9qZWN0LCBkdSwgY2FwYWJpbGl0aWVzLCBtYW5pZmVzdCwgZmlsZVBhdGgsIHJvb3REaXIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGdldENhcGFiaWxpdGllc0ZvckRVKFxuICBhbGxDYXBhYmlsaXRpZXM6IENhcGFiaWxpdHlEZXNjcmlwdG9yW10sXG4gIGR1OiBEZXBsb3ltZW50VW5pdERlc2NyaXB0b3IsXG4gIGNhcGFiaWxpdHlUb0RVOiBNYXA8c3RyaW5nLCBzdHJpbmc+XG4pOiBDYXBhYmlsaXR5RGVzY3JpcHRvcltdIHtcbiAgcmV0dXJuIGFsbENhcGFiaWxpdGllcy5maWx0ZXIoY2FwID0+IGNhcGFiaWxpdHlUb0RVLmdldChjYXAuaWQpID09PSBkdS5uYW1lKTtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVCb290c3RyYXBGaWxlV2l0aFRzTW9ycGgoXG4gIHByb2plY3Q6IFByb2plY3QsXG4gIGR1OiBEZXBsb3ltZW50VW5pdERlc2NyaXB0b3IsXG4gIGNhcGFiaWxpdGllczogQ2FwYWJpbGl0eURlc2NyaXB0b3JbXSxcbiAgbWFuaWZlc3Q6IE1hbmlmZXN0LFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICByb290RGlyOiBzdHJpbmdcbik6IHZvaWQge1xuICAvLyBBbmFseXplIGRlcGVuZGVuY2llcyBmb3IgdGhpcyBEVSB1c2luZyByZWFsIGZyYW1ld29yayBwYXR0ZXJuc1xuICBjb25zdCBkZXBlbmRlbmNpZXMgPSBhbmFseXplUmVhbERVRGVwZW5kZW5jaWVzKGR1Lm5hbWUsIGNhcGFiaWxpdGllcywgbWFuaWZlc3QsIHJvb3REaXIpO1xuICBcbiAgLy8gQ3JlYXRlIG9yIGdldCB0aGUgc291cmNlIGZpbGVcbiAgY29uc3Qgc291cmNlRmlsZSA9IHByb2plY3QuY3JlYXRlU291cmNlRmlsZShmaWxlUGF0aCwgXCJcIiwgeyBvdmVyd3JpdGU6IHRydWUgfSk7XG4gIFxuICAvLyBBZGQgZmlsZSBoZWFkZXIgY29tbWVudFxuICBzb3VyY2VGaWxlLmluc2VydFRleHQoMCwgYC8vIEdlbmVyYXRlZCBEVSBib290c3RyYXAgZm9yICR7ZHUubmFtZX1cXG4vLyBETyBOT1QgRURJVCAtIFRoaXMgZmlsZSBpcyBhdXRvLWdlbmVyYXRlZFxcblxcbmApO1xuICBcbiAgLy8gQWRkIGltcG9ydHNcbiAgYWRkSW1wb3J0cyhzb3VyY2VGaWxlLCBkZXBlbmRlbmNpZXMsIG1hbmlmZXN0LCByb290RGlyLCBmaWxlUGF0aCk7XG4gIFxuICAvLyBBZGQgc2V0dXBESSBmdW5jdGlvblxuICBhZGRTZXR1cERJRnVuY3Rpb24oc291cmNlRmlsZSwgZGVwZW5kZW5jaWVzKTtcbiAgXG4gIC8vIEFkZCBoYW5kbGVyIGZ1bmN0aW9uXG4gIGFkZEhhbmRsZXJGdW5jdGlvbihzb3VyY2VGaWxlLCBkdSwgZGVwZW5kZW5jaWVzKTtcbiAgXG4gIC8vIFNhdmUgdGhlIGZpbGUgd2l0aCBwcm9wZXIgZm9ybWF0dGluZ1xuICBzb3VyY2VGaWxlLnNhdmVTeW5jKCk7XG59XG5cbmZ1bmN0aW9uIGFkZEltcG9ydHMoXG4gIHNvdXJjZUZpbGU6IFNvdXJjZUZpbGUsIFxuICBkZXBlbmRlbmNpZXM6IFJlYWxEVURlcGVuZGVuY2llcyxcbiAgbWFuaWZlc3Q6IE1hbmlmZXN0LFxuICByb290RGlyOiBzdHJpbmcsXG4gIGJvb3RzdHJhcEZpbGVQYXRoOiBzdHJpbmdcbik6IHZvaWQge1xuICAvLyBDb3JlIGZyYW1ld29yayBpbXBvcnRzXG4gIGNvbnN0IGZyYW1ld29ya0ltcG9ydHMgPSBbJ0RJQ29udGFpbmVyJywgJ3JlZ2lzdGVyRW50aXR5U2NoZW1hJ107XG4gIHNvdXJjZUZpbGUuYWRkSW1wb3J0RGVjbGFyYXRpb24oe1xuICAgIG1vZHVsZVNwZWNpZmllcjogJ0B0ZW4yNGdyb3VwL2Z3MjQnLFxuICAgIG5hbWVkSW1wb3J0czogZnJhbWV3b3JrSW1wb3J0c1xuICB9KTtcbiAgXG4gIC8vIEFXUyBMYW1iZGEgdHlwZXNcbiAgc291cmNlRmlsZS5hZGRJbXBvcnREZWNsYXJhdGlvbih7XG4gICAgbW9kdWxlU3BlY2lmaWVyOiAnYXdzLWxhbWJkYScsXG4gICAgbmFtZWRJbXBvcnRzOiBbXG4gICAgICB7IG5hbWU6ICdBUElHYXRld2F5RXZlbnQnLCBpc1R5cGVPbmx5OiB0cnVlIH0sXG4gICAgICB7IG5hbWU6ICdBUElHYXRld2F5UHJveHlSZXN1bHQnLCBpc1R5cGVPbmx5OiB0cnVlIH0sXG4gICAgICB7IG5hbWU6ICdDb250ZXh0JywgaXNUeXBlT25seTogdHJ1ZSB9XG4gICAgXVxuICB9KTtcbiAgXG4gIC8vIEltcG9ydCBtb2R1bGVzXG4gIGZvciAoY29uc3QgbW9kdWxlIG9mIGRlcGVuZGVuY2llcy5tb2R1bGVzKSB7XG4gICAgaWYgKG1vZHVsZS5pbXBvcnRQYXRoLnN0YXJ0c1dpdGgoJ0AnKSkge1xuICAgICAgLy8gRXh0ZXJuYWwgbW9kdWxlXG4gICAgICBzb3VyY2VGaWxlLmFkZEltcG9ydERlY2xhcmF0aW9uKHtcbiAgICAgICAgbW9kdWxlU3BlY2lmaWVyOiBtb2R1bGUuaW1wb3J0UGF0aCxcbiAgICAgICAgbmFtZWRJbXBvcnRzOiBbbW9kdWxlLmNsYXNzTmFtZV1cbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBMb2NhbCBtb2R1bGUgLSBjYWxjdWxhdGUgcmVsYXRpdmUgcGF0aFxuICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gY2FsY3VsYXRlUmVsYXRpdmVJbXBvcnRQYXRoKGJvb3RzdHJhcEZpbGVQYXRoLCBqb2luKHJvb3REaXIsIG1vZHVsZS5pbXBvcnRQYXRoKSk7XG4gICAgICBzb3VyY2VGaWxlLmFkZEltcG9ydERlY2xhcmF0aW9uKHtcbiAgICAgICAgbW9kdWxlU3BlY2lmaWVyOiByZWxhdGl2ZVBhdGgsXG4gICAgICAgIG5hbWVkSW1wb3J0czogW21vZHVsZS5jbGFzc05hbWVdXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgXG4gIC8vIEltcG9ydCBlbnRpdHkgc2NoZW1hIGZhY3Rvcmllc1xuICBmb3IgKGNvbnN0IGVudGl0eSBvZiBkZXBlbmRlbmNpZXMuZW50aXRpZXMpIHtcbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBjYWxjdWxhdGVSZWxhdGl2ZUltcG9ydFBhdGgoYm9vdHN0cmFwRmlsZVBhdGgsIGpvaW4ocm9vdERpciwgZW50aXR5LnNjaGVtYUltcG9ydFBhdGgpKTtcbiAgICBzb3VyY2VGaWxlLmFkZEltcG9ydERlY2xhcmF0aW9uKHtcbiAgICAgIG1vZHVsZVNwZWNpZmllcjogcmVsYXRpdmVQYXRoLFxuICAgICAgbmFtZWRJbXBvcnRzOiBbZW50aXR5LnNjaGVtYUZhY3RvcnldXG4gICAgfSk7XG4gIH1cbiAgXG4gIC8vIEltcG9ydCBjb250cm9sbGVyc1xuICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgZGVwZW5kZW5jaWVzLmNvbnRyb2xsZXJzKSB7XG4gICAgY29uc3QgcmVsYXRpdmVQYXRoID0gY2FsY3VsYXRlUmVsYXRpdmVJbXBvcnRQYXRoKGJvb3RzdHJhcEZpbGVQYXRoLCBqb2luKHJvb3REaXIsIGNvbnRyb2xsZXIuaW1wb3J0UGF0aCkpO1xuICAgIHNvdXJjZUZpbGUuYWRkSW1wb3J0RGVjbGFyYXRpb24oe1xuICAgICAgbW9kdWxlU3BlY2lmaWVyOiByZWxhdGl2ZVBhdGgsXG4gICAgICBuYW1lZEltcG9ydHM6IFtjb250cm9sbGVyLmNsYXNzTmFtZV1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIEltcG9ydCBzZXJ2aWNlcyBmcm9tIG1hbmlmZXN0IG1vZHVsZXNcbiAgZm9yIChjb25zdCBtYW5pZmVzdE1vZHVsZSBvZiBtYW5pZmVzdC5tb2R1bGVzIHx8IFtdKSB7XG4gICAgaWYgKG1hbmlmZXN0TW9kdWxlLnJ1bnRpbWU/LnByb3ZpZGVycykge1xuICAgICAgY29uc3Qgc2VydmljZUNsYXNzTmFtZXMgPSBtYW5pZmVzdE1vZHVsZS5ydW50aW1lLnByb3ZpZGVyc1xuICAgICAgICAuZmlsdGVyKHAgPT4gcC5raW5kID09PSAnc2VydmljZScgJiYgcC51c2VDbGFzc1Rva2VuKVxuICAgICAgICAubWFwKHAgPT4gcC51c2VDbGFzc1Rva2VuISk7XG4gICAgICBcbiAgICAgIGlmIChzZXJ2aWNlQ2xhc3NOYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIEZpbmQgc2VydmljZSBpbXBvcnRzIC0gdGhleSdyZSB0eXBpY2FsbHkgaW4gc3JjL3NlcnZpY2VzL1xuICAgICAgICBmb3IgKGNvbnN0IHNlcnZpY2VOYW1lIG9mIHNlcnZpY2VDbGFzc05hbWVzKSB7XG4gICAgICAgICAgLy8gQ29udmVydCBzZXJ2aWNlIGNsYXNzIG5hbWUgdG8gbGlrZWx5IGZpbGUgcGF0aFxuICAgICAgICAgIGNvbnN0IHNlcnZpY2VQYXRoID0gYHNyYy9zZXJ2aWNlcy8ke3NlcnZpY2VOYW1lLnJlcGxhY2UoJ1NlcnZpY2UnLCAnJykudG9Mb3dlckNhc2UoKX1gO1xuICAgICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IGNhbGN1bGF0ZVJlbGF0aXZlSW1wb3J0UGF0aChib290c3RyYXBGaWxlUGF0aCwgam9pbihyb290RGlyLCBzZXJ2aWNlUGF0aCkpO1xuICAgICAgICAgIHNvdXJjZUZpbGUuYWRkSW1wb3J0RGVjbGFyYXRpb24oe1xuICAgICAgICAgICAgbW9kdWxlU3BlY2lmaWVyOiByZWxhdGl2ZVBhdGgsXG4gICAgICAgICAgICBuYW1lZEltcG9ydHM6IFtzZXJ2aWNlTmFtZV1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhZGRTZXR1cERJRnVuY3Rpb24oc291cmNlRmlsZTogU291cmNlRmlsZSwgZGVwZW5kZW5jaWVzOiBSZWFsRFVEZXBlbmRlbmNpZXMpOiB2b2lkIHtcbiAgY29uc3Qgc2V0dXBESUZ1bmN0aW9uID0gc291cmNlRmlsZS5hZGRGdW5jdGlvbih7XG4gICAgbmFtZTogJ3NldHVwREknLFxuICAgIHJldHVyblR5cGU6ICdESUNvbnRhaW5lcicsXG4gICAgc3RhdGVtZW50czogW1xuICAgICAgLy8gQ3JlYXRlIGNvbnRhaW5lclxuICAgICAgJ2NvbnN0IGNvbnRhaW5lciA9IG5ldyBESUNvbnRhaW5lcigpOycsXG4gICAgICAnJyxcbiAgICAgIC8vIEFkZCBhbGwgREkgcmVnaXN0cmF0aW9uc1xuICAgICAgLi4uZGVwZW5kZW5jaWVzLmRpUmVnaXN0cmF0aW9ucy5tYXAocmVnID0+IHJlZy5jb2RlKSxcbiAgICAgICcnLFxuICAgICAgJ3JldHVybiBjb250YWluZXI7J1xuICAgIF1cbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGFkZEhhbmRsZXJGdW5jdGlvbihzb3VyY2VGaWxlOiBTb3VyY2VGaWxlLCBkdTogRGVwbG95bWVudFVuaXREZXNjcmlwdG9yLCBkZXBlbmRlbmNpZXM6IFJlYWxEVURlcGVuZGVuY2llcyk6IHZvaWQge1xuICBpZiAoZHUua2luZCA9PT0gJ2FwaScpIHtcbiAgICBhZGRBUElIYW5kbGVyKHNvdXJjZUZpbGUsIGRlcGVuZGVuY2llcyk7XG4gIH0gZWxzZSB7XG4gICAgYWRkV29ya2VySGFuZGxlcihzb3VyY2VGaWxlLCBkZXBlbmRlbmNpZXMpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFkZEFQSUhhbmRsZXIoc291cmNlRmlsZTogU291cmNlRmlsZSwgZGVwZW5kZW5jaWVzOiBSZWFsRFVEZXBlbmRlbmNpZXMpOiB2b2lkIHtcbiAgY29uc3Qgcm91dGluZ1N0YXRlbWVudHMgPSBkZXBlbmRlbmNpZXMuY29udHJvbGxlcnMuZmxhdE1hcChjb250cm9sbGVyID0+IFtcbiAgICBgaWYgKHBhdGguc3RhcnRzV2l0aCgnJHtjb250cm9sbGVyLmJhc2VQYXRofScpKSB7YCxcbiAgICBgICBjb25zdCBjb250cm9sbGVySW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZSgnJHtjb250cm9sbGVyLmNsYXNzTmFtZX0nKSBhcyBhbnk7YCxcbiAgICBgICByZXR1cm4gYXdhaXQgY29udHJvbGxlckluc3RhbmNlLkxhbWJkYUhhbmRsZXIoZXZlbnQsIGNvbnRleHQpO2AsXG4gICAgYH1gXG4gIF0pO1xuICBcbiAgc291cmNlRmlsZS5hZGRGdW5jdGlvbih7XG4gICAgbmFtZTogJ2hhbmRsZXInLFxuICAgIGlzRXhwb3J0ZWQ6IHRydWUsXG4gICAgaXNBc3luYzogdHJ1ZSxcbiAgICBwYXJhbWV0ZXJzOiBbXG4gICAgICB7IG5hbWU6ICdldmVudCcsIHR5cGU6ICdBUElHYXRld2F5RXZlbnQnIH0sXG4gICAgICB7IG5hbWU6ICdjb250ZXh0JywgdHlwZTogJ0NvbnRleHQnIH1cbiAgICBdLFxuICAgIHJldHVyblR5cGU6ICdQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4nLFxuICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICdjb25zdCBjb250YWluZXIgPSBzZXR1cERJKCk7JyxcbiAgICAgICdjb25zdCBwYXRoID0gZXZlbnQucGF0aCB8fCBcIi9cIjsnLFxuICAgICAgJycsXG4gICAgICAnLy8gUm91dGUgdG8gYXBwcm9wcmlhdGUgY29udHJvbGxlciBiYXNlZCBvbiBwYXRoJyxcbiAgICAgIC4uLnJvdXRpbmdTdGF0ZW1lbnRzLFxuICAgICAgJycsXG4gICAgICAnLy8gRGVmYXVsdCA0MDQgcmVzcG9uc2UnLFxuICAgICAgJ3JldHVybiB7JyxcbiAgICAgICcgIHN0YXR1c0NvZGU6IDQwNCwnLFxuICAgICAgJyAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogXCJOb3QgRm91bmRcIiwgcGF0aCB9KScsXG4gICAgICAnfTsnXG4gICAgXVxuICB9KTtcbn1cblxuZnVuY3Rpb24gYWRkV29ya2VySGFuZGxlcihzb3VyY2VGaWxlOiBTb3VyY2VGaWxlLCBkZXBlbmRlbmNpZXM6IFJlYWxEVURlcGVuZGVuY2llcyk6IHZvaWQge1xuICBjb25zdCBmaXJzdENvbnRyb2xsZXIgPSBkZXBlbmRlbmNpZXMuY29udHJvbGxlcnNbMF07XG4gIFxuICBzb3VyY2VGaWxlLmFkZEZ1bmN0aW9uKHtcbiAgICBuYW1lOiAnaGFuZGxlcicsXG4gICAgaXNFeHBvcnRlZDogdHJ1ZSxcbiAgICBpc0FzeW5jOiB0cnVlLFxuICAgIHBhcmFtZXRlcnM6IFtcbiAgICAgIHsgbmFtZTogJ2V2ZW50JywgdHlwZTogJ2FueScgfSxcbiAgICAgIHsgbmFtZTogJ2NvbnRleHQnLCB0eXBlOiAnYW55JyB9XG4gICAgXSxcbiAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAnY29uc3QgY29udGFpbmVyID0gc2V0dXBESSgpOycsXG4gICAgICBgY29uc3QgaGFuZGxlciA9IGNvbnRhaW5lci5yZXNvbHZlKCcke2ZpcnN0Q29udHJvbGxlci5jbGFzc05hbWV9Jyk7YCxcbiAgICAgICcnLFxuICAgICAgJ3JldHVybiBoYW5kbGVyLmhhbmRsZShldmVudCwgY29udGV4dCk7J1xuICAgIF1cbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGNhbGN1bGF0ZVJlbGF0aXZlSW1wb3J0UGF0aChmcm9tRmlsZTogc3RyaW5nLCB0b0ZpbGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIC8vIEdldCB0aGUgZGlyZWN0b3J5IG9mIHRoZSBmcm9tIGZpbGVcbiAgY29uc3QgZnJvbURpciA9IGZyb21GaWxlLnJlcGxhY2UoL1teL10rJC8sICcnKTtcbiAgXG4gIC8vIFJlbW92ZSAudHMgZXh0ZW5zaW9uIGZyb20gdGFyZ2V0IGZpbGVcbiAgY29uc3QgY2xlYW5Ub0ZpbGUgPSB0b0ZpbGUucmVwbGFjZSgvXFwudHMkLywgJycpO1xuICBcbiAgLy8gQ2FsY3VsYXRlIHJlbGF0aXZlIHBhdGhcbiAgbGV0IHJlbGF0aXZlUGF0aCA9IHJlbGF0aXZlKGZyb21EaXIsIGNsZWFuVG9GaWxlKTtcbiAgXG4gIC8vIEVuc3VyZSByZWxhdGl2ZSBwYXRocyBzdGFydCB3aXRoICcuLycgb3IgJy4uLydcbiAgaWYgKCFyZWxhdGl2ZVBhdGguc3RhcnRzV2l0aCgnLicpKSB7XG4gICAgcmVsYXRpdmVQYXRoID0gJy4vJyArIHJlbGF0aXZlUGF0aDtcbiAgfVxuICBcbiAgcmV0dXJuIHJlbGF0aXZlUGF0aDtcbn1cbiJdfQ==