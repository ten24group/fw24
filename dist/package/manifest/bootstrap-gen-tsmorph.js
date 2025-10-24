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
    addImports(sourceFile, dependencies, rootDir, filePath);
    // Add setupDI function
    addSetupDIFunction(sourceFile, dependencies);
    // Add handler function
    addHandlerFunction(sourceFile, du, dependencies);
    // Save the file with proper formatting
    sourceFile.saveSync();
}
function addImports(sourceFile, dependencies, rootDir, bootstrapFilePath) {
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
    let relativePath = (0, path_1.relative)(fromFile.replace(/[^/]+$/, ''), toFile.replace(/\.ts$/, ''));
    // Ensure relative paths start with './' or '../'
    if (!relativePath.startsWith('.')) {
        relativePath = './' + relativePath;
    }
    return relativePath;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm9vdHN0cmFwLWdlbi10c21vcnBoLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL21hbmlmZXN0L2Jvb3RzdHJhcC1nZW4tdHNtb3JwaC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQVlBLG9EQTZCQztBQXpDRCwyQkFBMkM7QUFDM0MsK0JBQXNDO0FBQ3RDLHVDQUEyRjtBQUczRix5RUFBMkY7QUFPM0YsU0FBZ0Isb0JBQW9CLENBQ2xDLFFBQWtCLEVBQ2xCLE9BQXdCLEVBQ3hCLE9BQTRCO0lBRTVCLE1BQU0sRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLEdBQUcsT0FBTyxDQUFDO0lBRXZDLElBQUksQ0FBQyxJQUFBLGVBQVUsRUFBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQzNCLElBQUEsY0FBUyxFQUFDLFNBQVMsRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0lBQzVDLENBQUM7SUFFRCx3REFBd0Q7SUFDeEQsTUFBTSxPQUFPLEdBQUcsSUFBSSxrQkFBTyxDQUFDO1FBQzFCLHFCQUFxQixFQUFFLEtBQUs7UUFDNUIsMkJBQTJCLEVBQUUsSUFBSTtRQUNqQyxlQUFlLEVBQUU7WUFDZixNQUFNLEVBQUUsRUFBRSxFQUFFLFNBQVM7WUFDckIsTUFBTSxFQUFFLEVBQUUsRUFBRSxTQUFTO1lBQ3JCLE1BQU0sRUFBRSxJQUFJO1NBQ2I7S0FDRixDQUFDLENBQUM7SUFFSCxLQUFLLE1BQU0sRUFBRSxJQUFJLE9BQU8sQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUN6QyxNQUFNLFlBQVksR0FBRyxvQkFBb0IsQ0FBQyxRQUFRLENBQUMsWUFBWSxFQUFFLEVBQUUsRUFBRSxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDN0YsTUFBTSxRQUFRLEdBQUcsSUFBQSxXQUFJLEVBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxDQUFDLElBQUksZUFBZSxDQUFDLENBQUM7UUFFL0QsNkNBQTZDO1FBQzdDLGdD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cEIsc0RBQXNEO1lBQ3RELElBQUk7U0FDTDtLQUNGLENBQUMsQ0FBQztBQUNMLENBQUM7QUFFRCxTQUFTLGdCQUFnQixDQUFDLFVBQXNCLEVBQUUsWUFBZ0M7SUFDaEYsTUFBTSxlQUFlLEdBQUcsWUFBWSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUVwRCxVQUFVLENBQUMsV0FBVyxDQUFDO1FBQ3JCLElBQUksRUFBRSxTQUFTO1FBQ2YsVUFBVSxFQUFFLElBQUk7UUFDaEIsT0FBTyxFQUFFLElBQUk7UUFDYixVQUFVLEVBQUU7WUFDVixFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUM5QixFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRTtTQUNqQztRQUNELFVBQVUsRUFBRTtZQUNWLDhCQUE4QjtZQUM5QixzQ0FBc0MsZUFBZSxDQUFDLFNBQVMsS0FBSztZQUNwRSxFQUFFO1lBQ0Ysd0NBQXdDO1NBQ3pDO0tBQ0YsQ0FBQyxDQUFDO0FBQ0wsQ0FBQztBQUVELFNBQVMsMkJBQTJCLENBQUMsUUFBZ0IsRUFBRSxNQUFjO0lBQ25FLElBQUksWUFBWSxHQUFHLElBQUEsZUFBUSxFQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFFekYsaURBQWlEO0lBQ2pELElBQUksQ0FBQyxZQUFZLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDbEMsWUFBWSxHQUFHLElBQUksR0FBRyxZQUFZLENBQUM7SUFDckMsQ0FBQztJQUVELE9BQU8sWUFBWSxDQUFDO0FBQ3RCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBta2RpclN5bmMsIGV4aXN0c1N5bmMgfSBmcm9tICdmcyc7XG5pbXBvcnQgeyBqb2luLCByZWxhdGl2ZSB9IGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgUHJvamVjdCwgU291cmNlRmlsZSwgU3ludGF4S2luZCwgVmFyaWFibGVEZWNsYXJhdGlvbktpbmQsIFNjb3BlIH0gZnJvbSAndHMtbW9ycGgnO1xuaW1wb3J0IHsgQ2FwYWJpbGl0eURlc2NyaXB0b3IsIERlcGxveW1lbnRVbml0RGVzY3JpcHRvciwgTWFuaWZlc3QgfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IERVTWFwcGluZ1Jlc3VsdCB9IGZyb20gJy4vZHUtbWFwcGluZyc7XG5pbXBvcnQgeyBhbmFseXplUmVhbERVRGVwZW5kZW5jaWVzLCBSZWFsRFVEZXBlbmRlbmNpZXMgfSBmcm9tICcuL3JlYWwtZGVwZW5kZW5jeS1hbmFseXNpcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQm9vdHN0cmFwR2VuT3B0aW9ucyB7XG4gIG91dHB1dERpcjogc3RyaW5nOyAvLyAuZncyNC8uZ2VuZXJhdGVkXG4gIHJvb3REaXI6IHN0cmluZzsgICAvLyBwcm9qZWN0IHJvb3Rcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlRFVCb290c3RyYXBzKFxuICBtYW5pZmVzdDogTWFuaWZlc3QsIFxuICBtYXBwaW5nOiBEVU1hcHBpbmdSZXN1bHQsIFxuICBvcHRpb25zOiBCb290c3RyYXBHZW5PcHRpb25zXG4pOiB2b2lkIHtcbiAgY29uc3QgeyBvdXRwdXREaXIsIHJvb3REaXIgfSA9IG9wdGlvbnM7XG4gIFxuICBpZiAoIWV4aXN0c1N5bmMob3V0cHV0RGlyKSkge1xuICAgIG1rZGlyU3luYyhvdXRwdXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICB9XG5cbiAgLy8gQ3JlYXRlIHRzLW1vcnBoIHByb2plY3QgZm9yIEFTVC1iYXNlZCBjb2RlIGdlbmVyYXRpb25cbiAgY29uc3QgcHJvamVjdCA9IG5ldyBQcm9qZWN0KHtcbiAgICB1c2VJbk1lbW9yeUZpbGVTeXN0ZW06IGZhbHNlLFxuICAgIHNraXBBZGRpbmdGaWxlc0Zyb21Uc0NvbmZpZzogdHJ1ZSxcbiAgICBjb21waWxlck9wdGlvbnM6IHtcbiAgICAgIHRhcmdldDogOTksIC8vIEVTTmV4dFxuICAgICAgbW9kdWxlOiA5OSwgLy8gRVNOZXh0XG4gICAgICBzdHJpY3Q6IHRydWUsXG4gICAgfVxuICB9KTtcblxuICBmb3IgKGNvbnN0IGR1IG9mIG1hcHBpbmcuZGVwbG95bWVudFVuaXRzKSB7XG4gICAgY29uc3QgY2FwYWJpbGl0aWVzID0gZ2V0Q2FwYWJpbGl0aWVzRm9yRFUobWFuaWZlc3QuY2FwYWJpbGl0aWVzLCBkdSwgbWFwcGluZy5jYXBhYmlsaXR5VG9EVSk7XG4gICAgY29uc3QgZmlsZVBhdGggPSBqb2luKG91dHB1dERpciwgYGR1LSR7ZHUubmFtZX0uYm9vdHN0cmFwLnRzYCk7XG4gICAgXG4gICAgLy8gR2VuZXJhdGUgYm9vdHN0cmFwIGZpbGUgdXNpbmcgdHMtbW9ycGggQVNUXG4gICAgZ2VuZXJhdGVCb290c3RyYXBGaWxlV2l0aFRzTW9ycGgocHJvamVjdCwgZHUsIGNhcGFiaWxpdGllcywgbWFuaWZlc3QsIGZpbGVQYXRoLCByb290RGlyKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBnZXRDYXBhYmlsaXRpZXNGb3JEVShcbiAgYWxsQ2FwYWJpbGl0aWVzOiBDYXBhYmlsaXR5RGVzY3JpcHRvcltdLFxuICBkdTogRGVwbG95bWVudFVuaXREZXNjcmlwdG9yLFxuICBjYXBhYmlsaXR5VG9EVTogTWFwPHN0cmluZywgc3RyaW5nPlxuKTogQ2FwYWJpbGl0eURlc2NyaXB0b3JbXSB7XG4gIHJldHVybiBhbGxDYXBhYmlsaXRpZXMuZmlsdGVyKGNhcCA9PiBjYXBhYmlsaXR5VG9EVS5nZXQoY2FwLmlkKSA9PT0gZHUubmFtZSk7XG59XG5cbmZ1bmN0aW9uIGdlbmVyYXRlQm9vdHN0cmFwRmlsZVdpdGhUc01vcnBoKFxuICBwcm9qZWN0OiBQcm9qZWN0LFxuICBkdTogRGVwbG95bWVudFVuaXREZXNjcmlwdG9yLFxuICBjYXBhYmlsaXRpZXM6IENhcGFiaWxpdHlEZXNjcmlwdG9yW10sXG4gIG1hbmlmZXN0OiBNYW5pZmVzdCxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgcm9vdERpcjogc3RyaW5nXG4pOiB2b2lkIHtcbiAgLy8gQW5hbHl6ZSBkZXBlbmRlbmNpZXMgZm9yIHRoaXMgRFUgdXNpbmcgcmVhbCBmcmFtZXdvcmsgcGF0dGVybnNcbiAgY29uc3QgZGVwZW5kZW5jaWVzID0gYW5hbHl6ZVJlYWxEVURlcGVuZGVuY2llcyhkdS5uYW1lLCBjYXBhYmlsaXRpZXMsIG1hbmlmZXN0LCByb290RGlyKTtcbiAgXG4gIC8vIENyZWF0ZSBvciBnZXQgdGhlIHNvdXJjZSBmaWxlXG4gIGNvbnN0IHNvdXJjZUZpbGUgPSBwcm9qZWN0LmNyZWF0ZVNvdXJjZUZpbGUoZmlsZVBhdGgsIFwiXCIsIHsgb3ZlcndyaXRlOiB0cnVlIH0pO1xuICBcbiAgLy8gQWRkIGZpbGUgaGVhZGVyIGNvbW1lbnRcbiAgc291cmNlRmlsZS5pbnNlcnRUZXh0KDAsIGAvLyBHZW5lcmF0ZWQgRFUgYm9vdHN0cmFwIGZvciAke2R1Lm5hbWV9XFxuLy8gRE8gTk9UIEVESVQgLSBUaGlzIGZpbGUgaXMgYXV0by1nZW5lcmF0ZWRcXG5cXG5gKTtcbiAgXG4gIC8vIEFkZCBpbXBvcnRzXG4gIGFkZEltcG9ydHMoc291cmNlRmlsZSwgZGVwZW5kZW5jaWVzLCByb290RGlyLCBmaWxlUGF0aCk7XG4gIFxuICAvLyBBZGQgc2V0dXBESSBmdW5jdGlvblxuICBhZGRTZXR1cERJRnVuY3Rpb24oc291cmNlRmlsZSwgZGVwZW5kZW5jaWVzKTtcbiAgXG4gIC8vIEFkZCBoYW5kbGVyIGZ1bmN0aW9uXG4gIGFkZEhhbmRsZXJGdW5jdGlvbihzb3VyY2VGaWxlLCBkdSwgZGVwZW5kZW5jaWVzKTtcbiAgXG4gIC8vIFNhdmUgdGhlIGZpbGUgd2l0aCBwcm9wZXIgZm9ybWF0dGluZ1xuICBzb3VyY2VGaWxlLnNhdmVTeW5jKCk7XG59XG5cbmZ1bmN0aW9uIGFkZEltcG9ydHMoXG4gIHNvdXJjZUZpbGU6IFNvdXJjZUZpbGUsIFxuICBkZXBlbmRlbmNpZXM6IFJlYWxEVURlcGVuZGVuY2llcyxcbiAgcm9vdERpcjogc3RyaW5nLFxuICBib290c3RyYXBGaWxlUGF0aDogc3RyaW5nXG4pOiB2b2lkIHtcbiAgLy8gQ29yZSBmcmFtZXdvcmsgaW1wb3J0c1xuICBjb25zdCBmcmFtZXdvcmtJbXBvcnRzID0gWydESUNvbnRhaW5lcicsICdyZWdpc3RlckVudGl0eVNjaGVtYSddO1xuICBzb3VyY2VGaWxlLmFkZEltcG9ydERlY2xhcmF0aW9uKHtcbiAgICBtb2R1bGVTcGVjaWZpZXI6ICdAdGVuMjRncm91cC9mdzI0JyxcbiAgICBuYW1lZEltcG9ydHM6IGZyYW1ld29ya0ltcG9ydHNcbiAgfSk7XG4gIFxuICAvLyBBV1MgTGFtYmRhIHR5cGVzXG4gIHNvdXJjZUZpbGUuYWRkSW1wb3J0RGVjbGFyYXRpb24oe1xuICAgIG1vZHVsZVNwZWNpZmllcjogJ2F3cy1sYW1iZGEnLFxuICAgIG5hbWVkSW1wb3J0czogW1xuICAgICAgeyBuYW1lOiAnQVBJR2F0ZXdheUV2ZW50JywgaXNUeXBlT25seTogdHJ1ZSB9LFxuICAgICAgeyBuYW1lOiAnQVBJR2F0ZXdheVByb3h5UmVzdWx0JywgaXNUeXBlT25seTogdHJ1ZSB9LFxuICAgICAgeyBuYW1lOiAnQ29udGV4dCcsIGlzVHlwZU9ubHk6IHRydWUgfVxuICAgIF1cbiAgfSk7XG4gIFxuICAvLyBJbXBvcnQgbW9kdWxlc1xuICBmb3IgKGNvbnN0IG1vZHVsZSBvZiBkZXBlbmRlbmNpZXMubW9kdWxlcykge1xuICAgIGlmIChtb2R1bGUuaW1wb3J0UGF0aC5zdGFydHNXaXRoKCdAJykpIHtcbiAgICAgIC8vIEV4dGVybmFsIG1vZHVsZVxuICAgICAgc291cmNlRmlsZS5hZGRJbXBvcnREZWNsYXJhdGlvbih7XG4gICAgICAgIG1vZHVsZVNwZWNpZmllcjogbW9kdWxlLmltcG9ydFBhdGgsXG4gICAgICAgIG5hbWVkSW1wb3J0czogW21vZHVsZS5jbGFzc05hbWVdXG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gTG9jYWwgbW9kdWxlIC0gY2FsY3VsYXRlIHJlbGF0aXZlIHBhdGhcbiAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IGNhbGN1bGF0ZVJlbGF0aXZlSW1wb3J0UGF0aChib290c3RyYXBGaWxlUGF0aCwgam9pbihyb290RGlyLCBtb2R1bGUuaW1wb3J0UGF0aCkpO1xuICAgICAgc291cmNlRmlsZS5hZGRJbXBvcnREZWNsYXJhdGlvbih7XG4gICAgICAgIG1vZHVsZVNwZWNpZmllcjogcmVsYXRpdmVQYXRoLFxuICAgICAgICBuYW1lZEltcG9ydHM6IFttb2R1bGUuY2xhc3NOYW1lXVxuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIFxuICAvLyBJbXBvcnQgZW50aXR5IHNjaGVtYSBmYWN0b3JpZXNcbiAgZm9yIChjb25zdCBlbnRpdHkgb2YgZGVwZW5kZW5jaWVzLmVudGl0aWVzKSB7XG4gICAgY29uc3QgcmVsYXRpdmVQYXRoID0gY2FsY3VsYXRlUmVsYXRpdmVJbXBvcnRQYXRoKGJvb3RzdHJhcEZpbGVQYXRoLCBqb2luKHJvb3REaXIsIGVudGl0eS5zY2hlbWFJbXBvcnRQYXRoKSk7XG4gICAgc291cmNlRmlsZS5hZGRJbXBvcnREZWNsYXJhdGlvbih7XG4gICAgICBtb2R1bGVTcGVjaWZpZXI6IHJlbGF0aXZlUGF0aCxcbiAgICAgIG5hbWVkSW1wb3J0czogW2VudGl0eS5zY2hlbWFGYWN0b3J5XVxuICAgIH0pO1xuICB9XG4gIFxuICAvLyBJbXBvcnQgY29udHJvbGxlcnNcbiAgZm9yIChjb25zdCBjb250cm9sbGVyIG9mIGRlcGVuZGVuY2llcy5jb250cm9sbGVycykge1xuICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IGNhbGN1bGF0ZVJlbGF0aXZlSW1wb3J0UGF0aChib290c3RyYXBGaWxlUGF0aCwgam9pbihyb290RGlyLCBjb250cm9sbGVyLmltcG9ydFBhdGgpKTtcbiAgICBzb3VyY2VGaWxlLmFkZEltcG9ydERlY2xhcmF0aW9uKHtcbiAgICAgIG1vZHVsZVNwZWNpZmllcjogcmVsYXRpdmVQYXRoLFxuICAgICAgbmFtZWRJbXBvcnRzOiBbY29udHJvbGxlci5jbGFzc05hbWVdXG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYWRkU2V0dXBESUZ1bmN0aW9uKHNvdXJjZUZpbGU6IFNvdXJjZUZpbGUsIGRlcGVuZGVuY2llczogUmVhbERVRGVwZW5kZW5jaWVzKTogdm9pZCB7XG4gIGNvbnN0IHNldHVwRElGdW5jdGlvbiA9IHNvdXJjZUZpbGUuYWRkRnVuY3Rpb24oe1xuICAgIG5hbWU6ICdzZXR1cERJJyxcbiAgICByZXR1cm5UeXBlOiAnRElDb250YWluZXInLFxuICAgIHN0YXRlbWVudHM6IFtcbiAgICAgIC8vIENyZWF0ZSBjb250YWluZXJcbiAgICAgICdjb25zdCBjb250YWluZXIgPSBuZXcgRElDb250YWluZXIoKTsnLFxuICAgICAgJycsXG4gICAgICAvLyBBZGQgYWxsIERJIHJlZ2lzdHJhdGlvbnNcbiAgICAgIC4uLmRlcGVuZGVuY2llcy5kaVJlZ2lzdHJhdGlvbnMubWFwKHJlZyA9PiByZWcuY29kZSksXG4gICAgICAnJyxcbiAgICAgICdyZXR1cm4gY29udGFpbmVyOydcbiAgICBdXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBhZGRIYW5kbGVyRnVuY3Rpb24oc291cmNlRmlsZTogU291cmNlRmlsZSwgZHU6IERlcGxveW1lbnRVbml0RGVzY3JpcHRvciwgZGVwZW5kZW5jaWVzOiBSZWFsRFVEZXBlbmRlbmNpZXMpOiB2b2lkIHtcbiAgaWYgKGR1LmtpbmQgPT09ICdhcGknKSB7XG4gICAgYWRkQVBJSGFuZGxlcihzb3VyY2VGaWxlLCBkZXBlbmRlbmNpZXMpO1xuICB9IGVsc2Uge1xuICAgIGFkZFdvcmtlckhhbmRsZXIoc291cmNlRmlsZSwgZGVwZW5kZW5jaWVzKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhZGRBUElIYW5kbGVyKHNvdXJjZUZpbGU6IFNvdXJjZUZpbGUsIGRlcGVuZGVuY2llczogUmVhbERVRGVwZW5kZW5jaWVzKTogdm9pZCB7XG4gIGNvbnN0IHJvdXRpbmdTdGF0ZW1lbnRzID0gZGVwZW5kZW5jaWVzLmNvbnRyb2xsZXJzLmZsYXRNYXAoY29udHJvbGxlciA9PiBbXG4gICAgYGlmIChwYXRoLnN0YXJ0c1dpdGgoJyR7Y29udHJvbGxlci5iYXNlUGF0aH0nKSkge2AsXG4gICAgYCAgY29uc3QgY29udHJvbGxlckluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmUoJyR7Y29udHJvbGxlci5jbGFzc05hbWV9JykgYXMgYW55O2AsXG4gICAgYCAgcmV0dXJuIGF3YWl0IGNvbnRyb2xsZXJJbnN0YW5jZS5MYW1iZGFIYW5kbGVyKGV2ZW50LCBjb250ZXh0KTtgLFxuICAgIGB9YFxuICBdKTtcbiAgXG4gIHNvdXJjZUZpbGUuYWRkRnVuY3Rpb24oe1xuICAgIG5hbWU6ICdoYW5kbGVyJyxcbiAgICBpc0V4cG9ydGVkOiB0cnVlLFxuICAgIGlzQXN5bmM6IHRydWUsXG4gICAgcGFyYW1ldGVyczogW1xuICAgICAgeyBuYW1lOiAnZXZlbnQnLCB0eXBlOiAnQVBJR2F0ZXdheUV2ZW50JyB9LFxuICAgICAgeyBuYW1lOiAnY29udGV4dCcsIHR5cGU6ICdDb250ZXh0JyB9XG4gICAgXSxcbiAgICByZXR1cm5UeXBlOiAnUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+JyxcbiAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAnY29uc3QgY29udGFpbmVyID0gc2V0dXBESSgpOycsXG4gICAgICAnY29uc3QgcGF0aCA9IGV2ZW50LnBhdGggfHwgXCIvXCI7JyxcbiAgICAgICcnLFxuICAgICAgJy8vIFJvdXRlIHRvIGFwcHJvcHJpYXRlIGNvbnRyb2xsZXIgYmFzZWQgb24gcGF0aCcsXG4gICAgICAuLi5yb3V0aW5nU3RhdGVtZW50cyxcbiAgICAgICcnLFxuICAgICAgJy8vIERlZmF1bHQgNDA0IHJlc3BvbnNlJyxcbiAgICAgICdyZXR1cm4geycsXG4gICAgICAnICBzdGF0dXNDb2RlOiA0MDQsJyxcbiAgICAgICcgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IFwiTm90IEZvdW5kXCIsIHBhdGggfSknLFxuICAgICAgJ307J1xuICAgIF1cbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGFkZFdvcmtlckhhbmRsZXIoc291cmNlRmlsZTogU291cmNlRmlsZSwgZGVwZW5kZW5jaWVzOiBSZWFsRFVEZXBlbmRlbmNpZXMpOiB2b2lkIHtcbiAgY29uc3QgZmlyc3RDb250cm9sbGVyID0gZGVwZW5kZW5jaWVzLmNvbnRyb2xsZXJzWzBdO1xuICBcbiAgc291cmNlRmlsZS5hZGRGdW5jdGlvbih7XG4gICAgbmFtZTogJ2hhbmRsZXInLFxuICAgIGlzRXhwb3J0ZWQ6IHRydWUsXG4gICAgaXNBc3luYzogdHJ1ZSxcbiAgICBwYXJhbWV0ZXJzOiBbXG4gICAgICB7IG5hbWU6ICdldmVudCcsIHR5cGU6ICdhbnknIH0sXG4gICAgICB7IG5hbWU6ICdjb250ZXh0JywgdHlwZTogJ2FueScgfVxuICAgIF0sXG4gICAgc3RhdGVtZW50czogW1xuICAgICAgJ2NvbnN0IGNvbnRhaW5lciA9IHNldHVwREkoKTsnLFxuICAgICAgYGNvbnN0IGhhbmRsZXIgPSBjb250YWluZXIucmVzb2x2ZSgnJHtmaXJzdENvbnRyb2xsZXIuY2xhc3NOYW1lfScpO2AsXG4gICAgICAnJyxcbiAgICAgICdyZXR1cm4gaGFuZGxlci5oYW5kbGUoZXZlbnQsIGNvbnRleHQpOydcbiAgICBdXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBjYWxjdWxhdGVSZWxhdGl2ZUltcG9ydFBhdGgoZnJvbUZpbGU6IHN0cmluZywgdG9GaWxlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgcmVsYXRpdmVQYXRoID0gcmVsYXRpdmUoZnJvbUZpbGUucmVwbGFjZSgvW14vXSskLywgJycpLCB0b0ZpbGUucmVwbGFjZSgvXFwudHMkLywgJycpKTtcbiAgXG4gIC8vIEVuc3VyZSByZWxhdGl2ZSBwYXRocyBzdGFydCB3aXRoICcuLycgb3IgJy4uLydcbiAgaWYgKCFyZWxhdGl2ZVBhdGguc3RhcnRzV2l0aCgnLicpKSB7XG4gICAgcmVsYXRpdmVQYXRoID0gJy4vJyArIHJlbGF0aXZlUGF0aDtcbiAgfVxuICBcbiAgcmV0dXJuIHJlbGF0aXZlUGF0aDtcbn1cbiJdfQ==