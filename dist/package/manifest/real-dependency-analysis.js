"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeRealDUDependencies = analyzeRealDUDependencies;
const fs_1 = require("fs");
const path_1 = require("path");
const ts_morph_1 = require("ts-morph");
/**
 * Real dependency analysis that understands the fw24 framework patterns:
 * - @DIModule decorators and module registration
 * - registerEntitySchema() calls
 * - Module dependencies and topological ordering
 * - Proper DI container setup
 */
function analyzeRealDUDependencies(_duName, capabilities, manifest, rootDir = process.cwd()) {
    const modules = [];
    const entities = [];
    const controllers = [];
    const diRegistrations = [];
    // 1. Extract controllers from capabilities
    for (const capability of capabilities) {
        if (capability.kind === 'controller') {
            controllers.push({
                name: capability.id.split(':')[0],
                className: capability.exportName,
                importPath: capability.sourceFile,
                basePath: capability.routing?.basePath || `/${capability.id.split(':')[0]}`
            });
        }
    }
    // 2. Analyze the main DI file (src/di.ts) using AST parsing
    const diFilePath = (0, path_1.join)(rootDir, 'src/di.ts');
    if ((0, fs_1.existsSync)(diFilePath)) {
        const project = new ts_morph_1.Project({
            useInMemoryFileSystem: false,
            compilerOptions: {
                skipLibCheck: true,
                skipDefaultLibCheck: true
            }
        });
        const sourceFile = project.addSourceFileAtPath(diFilePath);
        // Extract @DIModule decorated classes
        extractDIModules(sourceFile, modules);
        // Extract registerEntitySchema calls
        extractEntitySchemaRegistrations(sourceFile, entities);
        // Extract module registrations like DIContainer.ROOT.module(AuthModule)
        extractModuleRegistrations(sourceFile, modules);
    }
    // 3. Generate DI registrations using REAL framework patterns from manifest
    // First: Register external modules (like AuthModule)
    const externalModules = modules.filter(m => m.importPath.startsWith('@'));
    for (const module of externalModules) {
        diRegistrations.push({
            type: 'module',
            code: `  container.module(${module.className});`
        });
    }
    // Second: Register local modules and get their DI containers
    const localModules = modules.filter(m => !m.importPath.startsWith('@'));
    for (const module of localModules) {
        diRegistrations.push({
            type: 'module',
            code: `  const { container: ${module.name}Container } = container.module(${module.className});`
        });
    }
    // Third: Register providers from manifest modules (if manifest has them)
    for (const manifestModule of manifest.modules || []) {
        if (manifestModule.runtime?.providers) {
            for (const provider of manifestModule.runtime.providers) {
                if (provider.kind === 'service' && provider.useClassToken) {
                    const forEntityPart = provider.forEntity ? `, forEntity: "${provider.forEntity}"` : '';
                    const typePart = provider.kind ? `, type: "${provider.kind}"` : '';
                    diRegistrations.push({
                        type: 'service',
                        code: `  ${manifestModule.name}Container.register({ provide: ${provider.useClassToken}, useClass: ${provider.useClassToken}${typePart}${forEntityPart} });`
                    });
                }
            }
        }
    }
    // Fourth: Register entity schemas with proper providedIn module reference
    for (const entity of entities) {
        diRegistrations.push({
            type: 'entity',
            code: `  registerEntitySchema({ forEntity: '${entity.name}', providedIn: ${entity.providedIn}, useFactory: ${entity.schemaFactory} });`
        });
    }
    // Fifth: Register controllers (these can be registered in any DI container)
    for (const controller of controllers) {
        diRegistrations.push({
            type: 'controller',
            code: `  container.register({ provide: '${controller.className}', useClass: ${controller.className} });`
        });
    }
    return {
        modules,
        entities,
        controllers,
        diRegistrations
    };
}
function extractDIModules(sourceFile, modules) {
    // Find classes with @DIModule decorator
    const classes = sourceFile.getClasses();
    for (const classDecl of classes) {
        const diModuleDecorator = classDecl.getDecorator('DIModule');
        if (diModuleDecorator) {
            modules.push({
                name: classDecl.getName() || 'UnknownModule',
                className: classDecl.getName() || 'UnknownModule',
                importPath: 'src/di.ts',
                hasRuntimeProviders: false, // TODO: Check for runtimeProviders method
                dependencies: [] // TODO: Extract from imports
            });
        }
    }
}
function extractEntitySchemaRegistrations(sourceFile, entities) {
    // Find all registerEntitySchema call expressions
    const callExpressions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.CallExpression);
    for (const callExpr of callExpressions) {
        if (callExpr.getExpression().getText() === 'registerEntitySchema') {
            const args = callExpr.getArguments();
            if (args.length > 0 && args[0].getKind() === ts_morph_1.SyntaxKind.ObjectLiteralExpression) {
                const objLiteral = args[0].asKindOrThrow(ts_morph_1.SyntaxKind.ObjectLiteralExpression);
                let forEntity = '';
                let useFactory = '';
                let providedIn = '';
                // Extract properties from object literal
                for (const prop of objLiteral.getProperties()) {
                    if (prop.getKind() === ts_morph_1.SyntaxKind.PropertyAssignment) {
                        const propAssignment = prop.asKindOrThrow(ts_morph_1.SyntaxKind.PropertyAssignment);
                        const propName = propAssignment.getName();
                        const propValue = propAssignment.getInitializer()?.getText().replace(/['"]/g, '');
                        if (propName === 'forEntity' && propValue) {
                            forEntity = propValue;
                        }
                        else if (propName === 'useFactory' && propValue) {
                            useFactory = propValue;
                        }
                        else if (propName === 'providedIn' && propValue) {
                            providedIn = propValue;
                        }
                    }
                }
                if (forEntity && useFactory && providedIn) {
                    entities.push({
                        name: forEntity,
                        schemaToken: `${forEntity}Schema`,
                        schemaFactory: useFactory,
                        schemaImportPath: findImportPathForIdentifier(sourceFile, useFactory),
                        providedIn: providedIn
                    });
                }
            }
        }
    }
}
function extractModuleRegistrations(sourceFile, modules) {
    // Find DIContainer.ROOT.module(ModuleName) calls
    const callExpressions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.CallExpression);
    for (const callExpr of callExpressions) {
        const expression = callExpr.getExpression();
        // Check if it's a property access expression like DIContainer.ROOT.module
        if (expression.getKind() === ts_morph_1.SyntaxKind.PropertyAccessExpression) {
            const propAccess = expression.asKindOrThrow(ts_morph_1.SyntaxKind.PropertyAccessExpression);
            if (propAccess.getText().includes('DIContainer.ROOT.module') ||
                propAccess.getText().endsWith('.module')) {
                const args = callExpr.getArguments();
                if (args.length > 0) {
                    const moduleName = args[0].getText();
                    // Find existing module or create new one
                    let moduleInfo = modules.find(m => m.name === moduleName);
                    if (!moduleInfo) {
                        moduleInfo = {
                            name: moduleName,
                            className: moduleName,
                            importPath: findImportPathForIdentifier(sourceFile, moduleName),
                            hasRuntimeProviders: true,
                            dependencies: []
                        };
                        modules.push(moduleInfo);
                    }
                }
            }
        }
    }
}
function findImportPathForIdentifier(sourceFile, identifier) {
    // Find import declaration that imports this identifier
    const importDeclarations = sourceFile.getImportDeclarations();
    for (const importDecl of importDeclarations) {
        const namedImports = importDecl.getNamedImports();
        for (const namedImport of namedImports) {
            if (namedImport.getName() === identifier) {
                let importPath = importDecl.getModuleSpecifierValue();
                // Convert relative imports to absolute paths from project root
                if (importPath.startsWith('./')) {
                    importPath = importPath.replace('./', 'src/');
                }
                else if (importPath.startsWith('../')) {
                    // Handle ../ paths if needed
                    importPath = importPath.replace('../', '');
                }
                // Ensure .ts extension
                if (!importPath.endsWith('.ts') && !importPath.startsWith('@')) {
                    importPath += '.ts';
                }
                return importPath;
            }
        }
    }
    // Fallback to reasonable guess with correct paths
    if (identifier.includes('create') && identifier.includes('Schema')) {
        const entityName = identifier.replace('create', '').replace('Schema', '');
        // Convert PascalCase to kebab-case for file names
        const fileName = entityName.replace(/([A-Z])/g, (_match, p1, offset) => offset > 0 ? '-' + p1.toLowerCase() : p1.toLowerCase());
        return `src/entities/${fileName}.schema.ts`;
    }
    if (identifier.includes('Module')) {
        return `@ten24group/fw24-${identifier.replace('Module', '').toLowerCase()}`;
    }
    return `src/unknown-import-${identifier}.ts`;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVhbC1kZXBlbmRlbmN5LWFuYWx5c2lzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL21hbmlmZXN0L3JlYWwtZGVwZW5kZW5jeS1hbmFseXNpcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQWtEQSw4REF5R0M7QUExSkQsMkJBQWdDO0FBQ2hDLCtCQUE0QjtBQUM1Qix1Q0FBK0Y7QUF3Qy9GOzs7Ozs7R0FNRztBQUNILFNBQWdCLHlCQUF5QixDQUN2QyxPQUFlLEVBQ2YsWUFBb0MsRUFDcEMsUUFBa0IsRUFDbEIsVUFBa0IsT0FBTyxDQUFDLEdBQUcsRUFBRTtJQUcvQixNQUFNLE9BQU8sR0FBaUIsRUFBRSxDQUFDO0lBQ2pDLE1BQU0sUUFBUSxHQUFpQixFQUFFLENBQUM7SUFDbEMsTUFBTSxXQUFXLEdBQXFCLEVBQUUsQ0FBQztJQUN6QyxNQUFNLGVBQWUsR0FBcUIsRUFBRSxDQUFDO0lBRTdDLDJDQUEyQztJQUMzQyxLQUFLLE1BQU0sVUFBVSxJQUFJLFlBQVksRUFBRSxDQUFDO1FBQ3RDLElBQUksVUFBVSxDQUFDLElBQUksS0FBSyxZQUFZLEVBQUUsQ0FBQztZQUNyQyxXQUFXLENBQUMsSUFBSSxDQUFDO2dCQUNmLElBQUksRUFBRSxVQUFVLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ2pDLFNBQVMsRUFBRSxVQUFVLENBQUMsVUFBVTtnQkFDaEMsVUFBVSxFQUFFLFVBQVUsQ0FBQyxVQUFVO2dCQUNqQyxRQUFRLEVBQUUsVUFBVSxDQUFDLE9BQU8sRUFBRSxRQUFRLElBQUksSUFBSSxVQUFVLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRTthQUM1RSxDQUFDLENBQUM7UUFDTCxDQUFDO0lBQ0gsQ0FBQztJQUVELDREQUE0RDtJQUM1RCxNQUFNLFVBQVUsR0FBRyxJQUFBLFdBQUksRUFBQyxPQUFPLEVB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Q0FDckUsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUN2RCxDQUFDO1FBQ0YsT0FBTyxnQkFBZ0IsUUFBUSxZQUFZLENBQUM7SUFDOUMsQ0FBQztJQUVELElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO1FBQ2xDLE9BQU8sb0JBQW9CLFVBQVUsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7SUFDOUUsQ0FBQztJQUVELE9BQU8sc0JBQXNCLFVBQVUsS0FBSyxDQUFDO0FBQy9DLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBNYW5pZmVzdCwgQ2FwYWJpbGl0eURlc2NyaXB0b3IsIE1vZHVsZURlc2NyaXB0b3IsIEVudGl0eURlc2NyaXB0b3IgfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tICdmcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBQcm9qZWN0LCBTb3VyY2VGaWxlLCBTeW50YXhLaW5kLCBDYWxsRXhwcmVzc2lvbiwgUHJvcGVydHlBc3NpZ25tZW50IH0gZnJvbSAndHMtbW9ycGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJlYWxEVURlcGVuZGVuY2llcyB7XG4gIG1vZHVsZXM6IE1vZHVsZUluZm9bXTtcbiAgZW50aXRpZXM6IEVudGl0eUluZm9bXTtcbiAgY29udHJvbGxlcnM6IENvbnRyb2xsZXJJbmZvW107XG4gIGRpUmVnaXN0cmF0aW9uczogRElSZWdpc3RyYXRpb25bXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBNb2R1bGVJbmZvIHtcbiAgbmFtZTogc3RyaW5nO1xuICBjbGFzc05hbWU6IHN0cmluZztcbiAgaW1wb3J0UGF0aDogc3RyaW5nO1xuICBoYXNSdW50aW1lUHJvdmlkZXJzOiBib29sZWFuO1xuICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdOyAvLyBPdGhlciBtb2R1bGVzIHRoaXMgZGVwZW5kcyBvblxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEVudGl0eUluZm8ge1xuICBuYW1lOiBzdHJpbmc7XG4gIHNjaGVtYVRva2VuOiBzdHJpbmc7XG4gIHNjaGVtYUZhY3Rvcnk6IHN0cmluZztcbiAgc2NoZW1hSW1wb3J0UGF0aDogc3RyaW5nO1xuICBzZXJ2aWNlVG9rZW4/OiBzdHJpbmc7XG4gIHNlcnZpY2VDbGFzcz86IHN0cmluZztcbiAgc2VydmljZUltcG9ydFBhdGg/OiBzdHJpbmc7XG4gIHByb3ZpZGVkSW46IHN0cmluZzsgLy8gTW9kdWxlIG5hbWVcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDb250cm9sbGVySW5mbyB7XG4gIG5hbWU6IHN0cmluZztcbiAgY2xhc3NOYW1lOiBzdHJpbmc7XG4gIGltcG9ydFBhdGg6IHN0cmluZztcbiAgYmFzZVBhdGg6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBESVJlZ2lzdHJhdGlvbiB7XG4gIHR5cGU6ICdtb2R1bGUnIHwgJ2VudGl0eScgfCAnc2VydmljZScgfCAnY29udHJvbGxlcic7XG4gIGNvZGU6IHN0cmluZztcbn1cblxuLyoqXG4gKiBSZWFsIGRlcGVuZGVuY3kgYW5hbHlzaXMgdGhhdCB1bmRlcnN0YW5kcyB0aGUgZncyNCBmcmFtZXdvcmsgcGF0dGVybnM6XG4gKiAtIEBESU1vZHVsZSBkZWNvcmF0b3JzIGFuZCBtb2R1bGUgcmVnaXN0cmF0aW9uXG4gKiAtIHJlZ2lzdGVyRW50aXR5U2NoZW1hKCkgY2FsbHNcbiAqIC0gTW9kdWxlIGRlcGVuZGVuY2llcyBhbmQgdG9wb2xvZ2ljYWwgb3JkZXJpbmdcbiAqIC0gUHJvcGVyIERJIGNvbnRhaW5lciBzZXR1cFxuICovXG5leHBvcnQgZnVuY3Rpb24gYW5hbHl6ZVJlYWxEVURlcGVuZGVuY2llcyhcbiAgX2R1TmFtZTogc3RyaW5nLFxuICBjYXBhYmlsaXRpZXM6IENhcGFiaWxpdHlEZXNjcmlwdG9yW10sXG4gIG1hbmlmZXN0OiBNYW5pZmVzdCxcbiAgcm9vdERpcjogc3RyaW5nID0gcHJvY2Vzcy5jd2QoKVxuKTogUmVhbERVRGVwZW5kZW5jaWVzIHtcbiAgXG4gIGNvbnN0IG1vZHVsZXM6IE1vZHVsZUluZm9bXSA9IFtdO1xuICBjb25zdCBlbnRpdGllczogRW50aXR5SW5mb1tdID0gW107XG4gIGNvbnN0IGNvbnRyb2xsZXJzOiBDb250cm9sbGVySW5mb1tdID0gW107XG4gIGNvbnN0IGRpUmVnaXN0cmF0aW9uczogRElSZWdpc3RyYXRpb25bXSA9IFtdO1xuXG4gIC8vIDEuIEV4dHJhY3QgY29udHJvbGxlcnMgZnJvbSBjYXBhYmlsaXRpZXNcbiAgZm9yIChjb25zdCBjYXBhYmlsaXR5IG9mIGNhcGFiaWxpdGllcykge1xuICAgIGlmIChjYXBhYmlsaXR5LmtpbmQgPT09ICdjb250cm9sbGVyJykge1xuICAgICAgY29udHJvbGxlcnMucHVzaCh7XG4gICAgICAgIG5hbWU6IGNhcGFiaWxpdHkuaWQuc3BsaXQoJzonKVswXSxcbiAgICAgICAgY2xhc3NOYW1lOiBjYXBhYmlsaXR5LmV4cG9ydE5hbWUsXG4gICAgICAgIGltcG9ydFBhdGg6IGNhcGFiaWxpdHkuc291cmNlRmlsZSxcbiAgICAgICAgYmFzZVBhdGg6IGNhcGFiaWxpdHkucm91dGluZz8uYmFzZVBhdGggfHwgYC8ke2NhcGFiaWxpdHkuaWQuc3BsaXQoJzonKVswXX1gXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvLyAyLiBBbmFseXplIHRoZSBtYWluIERJIGZpbGUgKHNyYy9kaS50cykgdXNpbmcgQVNUIHBhcnNpbmdcbiAgY29uc3QgZGlGaWxlUGF0aCA9IGpvaW4ocm9vdERpciwgJ3NyYy9kaS50cycpO1xuICBpZiAoZXhpc3RzU3luYyhkaUZpbGVQYXRoKSkge1xuICAgIGNvbnN0IHByb2plY3QgPSBuZXcgUHJvamVjdCh7XG4gICAgICB1c2VJbk1lbW9yeUZpbGVTeXN0ZW06IGZhbHNlLFxuICAgICAgY29tcGlsZXJPcHRpb25zOiB7XG4gICAgICAgIHNraXBMaWJDaGVjazogdHJ1ZSxcbiAgICAgICAgc2tpcERlZmF1bHRMaWJDaGVjazogdHJ1ZVxuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIGNvbnN0IHNvdXJjZUZpbGUgPSBwcm9qZWN0LmFkZFNvdXJjZUZpbGVBdFBhdGgoZGlGaWxlUGF0aCk7XG4gICAgXG4gICAgLy8gRXh0cmFjdCBARElNb2R1bGUgZGVjb3JhdGVkIGNsYXNzZXNcbiAgICBleHRyYWN0RElNb2R1bGVzKHNvdXJjZUZpbGUsIG1vZHVsZXMpO1xuICAgIFxuICAgIC8vIEV4dHJhY3QgcmVnaXN0ZXJFbnRpdHlTY2hlbWEgY2FsbHNcbiAgICBleHRyYWN0RW50aXR5U2NoZW1hUmVnaXN0cmF0aW9ucyhzb3VyY2VGaWxlLCBlbnRpdGllcyk7XG4gICAgXG4gICAgLy8gRXh0cmFjdCBtb2R1bGUgcmVnaXN0cmF0aW9ucyBsaWtlIERJQ29udGFpbmVyLlJPT1QubW9kdWxlKEF1dGhNb2R1bGUpXG4gICAgZXh0cmFjdE1vZHVsZVJlZ2lzdHJhdGlvbnMoc291cmNlRmlsZSwgbW9kdWxlcyk7XG4gIH1cblxuICAvLyAzLiBHZW5lcmF0ZSBESSByZWdpc3RyYXRpb25zIHVzaW5nIFJFQUwgZnJhbWV3b3JrIHBhdHRlcm5zIGZyb20gbWFuaWZlc3RcbiAgXG4gIC8vIEZpcnN0OiBSZWdpc3RlciBleHRlcm5hbCBtb2R1bGVzIChsaWtlIEF1dGhNb2R1bGUpXG4gIGNvbnN0IGV4dGVybmFsTW9kdWxlcyA9IG1vZHVsZXMuZmlsdGVyKG0gPT4gbS5pbXBvcnRQYXRoLnN0YXJ0c1dpdGgoJ0AnKSk7XG4gIGZvciAoY29uc3QgbW9kdWxlIG9mIGV4dGVybmFsTW9kdWxlcykge1xuICAgIGRpUmVnaXN0cmF0aW9ucy5wdXNoKHtcbiAgICAgIHR5cGU6ICdtb2R1bGUnLFxuICAgICAgY29kZTogYCAgY29udGFpbmVyLm1vZHVsZSgke21vZHVsZS5jbGFzc05hbWV9KTtgXG4gICAgfSk7XG4gIH1cblxuICAvLyBTZWNvbmQ6IFJlZ2lzdGVyIGxvY2FsIG1vZHVsZXMgYW5kIGdldCB0aGVpciBESSBjb250YWluZXJzXG4gIGNvbnN0IGxvY2FsTW9kdWxlcyA9IG1vZHVsZXMuZmlsdGVyKG0gPT4gIW0uaW1wb3J0UGF0aC5zdGFydHNXaXRoKCdAJykpO1xuICBmb3IgKGNvbnN0IG1vZHVsZSBvZiBsb2NhbE1vZHVsZXMpIHtcbiAgICBkaVJlZ2lzdHJhdGlvbnMucHVzaCh7XG4gICAgICB0eXBlOiAnbW9kdWxlJywgXG4gICAgICBjb2RlOiBgICBjb25zdCB7IGNvbnRhaW5lcjogJHttb2R1bGUubmFtZX1Db250YWluZXIgfSA9IGNvbnRhaW5lci5tb2R1bGUoJHttb2R1bGUuY2xhc3NOYW1lfSk7YFxuICAgIH0pO1xuICB9XG5cbiAgLy8gVGhpcmQ6IFJlZ2lzdGVyIHByb3ZpZGVycyBmcm9tIG1hbmlmZXN0IG1vZHVsZXMgKGlmIG1hbmlmZXN0IGhhcyB0aGVtKVxuICBmb3IgKGNvbnN0IG1hbmlmZXN0TW9kdWxlIG9mIG1hbmlmZXN0Lm1vZHVsZXMgfHwgW10pIHtcbiAgICBpZiAobWFuaWZlc3RNb2R1bGUucnVudGltZT8ucHJvdmlkZXJzKSB7XG4gICAgICBmb3IgKGNvbnN0IHByb3ZpZGVyIG9mIG1hbmlmZXN0TW9kdWxlLnJ1bnRpbWUucHJvdmlkZXJzKSB7XG4gICAgICAgIGlmIChwcm92aWRlci5raW5kID09PSAnc2VydmljZScgJiYgcHJvdmlkZXIudXNlQ2xhc3NUb2tlbikge1xuICAgICAgICAgIGNvbnN0IGZvckVudGl0eVBhcnQgPSBwcm92aWRlci5mb3JFbnRpdHkgPyBgLCBmb3JFbnRpdHk6IFwiJHtwcm92aWRlci5mb3JFbnRpdHl9XCJgIDogJyc7XG4gICAgICAgICAgY29uc3QgdHlwZVBhcnQgPSBwcm92aWRlci5raW5kID8gYCwgdHlwZTogXCIke3Byb3ZpZGVyLmtpbmR9XCJgIDogJyc7XG4gICAgICAgICAgZGlSZWdpc3RyYXRpb25zLnB1c2goe1xuICAgICAgICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgY29kZTogYCAgJHttYW5pZmVzdE1vZHVsZS5uYW1lfUNvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6ICR7cHJvdmlkZXIudXNlQ2xhc3NUb2tlbn0sIHVzZUNsYXNzOiAke3Byb3ZpZGVyLnVzZUNsYXNzVG9rZW59JHt0eXBlUGFydH0ke2ZvckVudGl0eVBhcnR9IH0pO2BcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEZvdXJ0aDogUmVnaXN0ZXIgZW50aXR5IHNjaGVtYXMgd2l0aCBwcm9wZXIgcHJvdmlkZWRJbiBtb2R1bGUgcmVmZXJlbmNlXG4gIGZvciAoY29uc3QgZW50aXR5IG9mIGVudGl0aWVzKSB7XG4gICAgZGlSZWdpc3RyYXRpb25zLnB1c2goe1xuICAgICAgdHlwZTogJ2VudGl0eScsXG4gICAgICBjb2RlOiBgICByZWdpc3RlckVudGl0eVNjaGVtYSh7IGZvckVudGl0eTogJyR7ZW50aXR5Lm5hbWV9JywgcHJvdmlkZWRJbjogJHtlbnRpdHkucHJvdmlkZWRJbn0sIHVzZUZhY3Rvcnk6ICR7ZW50aXR5LnNjaGVtYUZhY3Rvcnl9IH0pO2BcbiAgICB9KTtcbiAgfVxuXG4gIC8vIEZpZnRoOiBSZWdpc3RlciBjb250cm9sbGVycyAodGhlc2UgY2FuIGJlIHJlZ2lzdGVyZWQgaW4gYW55IERJIGNvbnRhaW5lcilcbiAgZm9yIChjb25zdCBjb250cm9sbGVyIG9mIGNvbnRyb2xsZXJzKSB7XG4gICAgZGlSZWdpc3RyYXRpb25zLnB1c2goe1xuICAgICAgdHlwZTogJ2NvbnRyb2xsZXInLFxuICAgICAgY29kZTogYCAgY29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogJyR7Y29udHJvbGxlci5jbGFzc05hbWV9JywgdXNlQ2xhc3M6ICR7Y29udHJvbGxlci5jbGFzc05hbWV9IH0pO2BcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgbW9kdWxlcyxcbiAgICBlbnRpdGllcyxcbiAgICBjb250cm9sbGVycyxcbiAgICBkaVJlZ2lzdHJhdGlvbnNcbiAgfTtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdERJTW9kdWxlcyhzb3VyY2VGaWxlOiBTb3VyY2VGaWxlLCBtb2R1bGVzOiBNb2R1bGVJbmZvW10pOiB2b2lkIHtcbiAgLy8gRmluZCBjbGFzc2VzIHdpdGggQERJTW9kdWxlIGRlY29yYXRvclxuICBjb25zdCBjbGFzc2VzID0gc291cmNlRmlsZS5nZXRDbGFzc2VzKCk7XG4gIFxuICBmb3IgKGNvbnN0IGNsYXNzRGVjbCBvZiBjbGFzc2VzKSB7XG4gICAgY29uc3QgZGlNb2R1bGVEZWNvcmF0b3IgPSBjbGFzc0RlY2wuZ2V0RGVjb3JhdG9yKCdESU1vZHVsZScpO1xuICAgIGlmIChkaU1vZHVsZURlY29yYXRvcikge1xuICAgICAgbW9kdWxlcy5wdXNoKHtcbiAgICAgICAgbmFtZTogY2xhc3NEZWNsLmdldE5hbWUoKSB8fCAnVW5rbm93bk1vZHVsZScsXG4gICAgICAgIGNsYXNzTmFtZTogY2xhc3NEZWNsLmdldE5hbWUoKSB8fCAnVW5rbm93bk1vZHVsZScsXG4gICAgICAgIGltcG9ydFBhdGg6ICdzcmMvZGkudHMnLFxuICAgICAgICBoYXNSdW50aW1lUHJvdmlkZXJzOiBmYWxzZSwgLy8gVE9ETzogQ2hlY2sgZm9yIHJ1bnRpbWVQcm92aWRlcnMgbWV0aG9kXG4gICAgICAgIGRlcGVuZGVuY2llczogW10gLy8gVE9ETzogRXh0cmFjdCBmcm9tIGltcG9ydHNcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBleHRyYWN0RW50aXR5U2NoZW1hUmVnaXN0cmF0aW9ucyhzb3VyY2VGaWxlOiBTb3VyY2VGaWxlLCBlbnRpdGllczogRW50aXR5SW5mb1tdKTogdm9pZCB7XG4gIC8vIEZpbmQgYWxsIHJlZ2lzdGVyRW50aXR5U2NoZW1hIGNhbGwgZXhwcmVzc2lvbnNcbiAgY29uc3QgY2FsbEV4cHJlc3Npb25zID0gc291cmNlRmlsZS5nZXREZXNjZW5kYW50c09mS2luZChTeW50YXhLaW5kLkNhbGxFeHByZXNzaW9uKTtcbiAgXG4gIGZvciAoY29uc3QgY2FsbEV4cHIgb2YgY2FsbEV4cHJlc3Npb25zKSB7XG4gICAgaWYgKGNhbGxFeHByLmdldEV4cHJlc3Npb24oKS5nZXRUZXh0KCkgPT09ICdyZWdpc3RlckVudGl0eVNjaGVtYScpIHtcbiAgICAgIGNvbnN0IGFyZ3MgPSBjYWxsRXhwci5nZXRBcmd1bWVudHMoKTtcbiAgICAgIGlmIChhcmdzLmxlbmd0aCA+IDAgJiYgYXJnc1swXS5nZXRLaW5kKCkgPT09IFN5bnRheEtpbmQuT2JqZWN0TGl0ZXJhbEV4cHJlc3Npb24pIHtcbiAgICAgICAgY29uc3Qgb2JqTGl0ZXJhbCA9IGFyZ3NbMF0uYXNLaW5kT3JUaHJvdyhTeW50YXhLaW5kLk9iamVjdExpdGVyYWxFeHByZXNzaW9uKTtcbiAgICAgICAgXG4gICAgICAgIGxldCBmb3JFbnRpdHkgPSAnJztcbiAgICAgICAgbGV0IHVzZUZhY3RvcnkgPSAnJztcbiAgICAgICAgbGV0IHByb3ZpZGVkSW4gPSAnJztcbiAgICAgICAgXG4gICAgICAgIC8vIEV4dHJhY3QgcHJvcGVydGllcyBmcm9tIG9iamVjdCBsaXRlcmFsXG4gICAgICAgIGZvciAoY29uc3QgcHJvcCBvZiBvYmpMaXRlcmFsLmdldFByb3BlcnRpZXMoKSkge1xuICAgICAgICAgIGlmIChwcm9wLmdldEtpbmQoKSA9PT0gU3ludGF4S2luZC5Qcm9wZXJ0eUFzc2lnbm1lbnQpIHtcbiAgICAgICAgICAgIGNvbnN0IHByb3BBc3NpZ25tZW50ID0gcHJvcC5hc0tpbmRPclRocm93KFN5bnRheEtpbmQuUHJvcGVydHlBc3NpZ25tZW50KTtcbiAgICAgICAgICAgIGNvbnN0IHByb3BOYW1lID0gcHJvcEFzc2lnbm1lbnQuZ2V0TmFtZSgpO1xuICAgICAgICAgICAgY29uc3QgcHJvcFZhbHVlID0gcHJvcEFzc2lnbm1lbnQuZ2V0SW5pdGlhbGl6ZXIoKT8uZ2V0VGV4dCgpLnJlcGxhY2UoL1snXCJdL2csICcnKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHByb3BOYW1lID09PSAnZm9yRW50aXR5JyAmJiBwcm9wVmFsdWUpIHtcbiAgICAgICAgICAgICAgZm9yRW50aXR5ID0gcHJvcFZhbHVlO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChwcm9wTmFtZSA9PT0gJ3VzZUZhY3RvcnknICYmIHByb3BWYWx1ZSkge1xuICAgICAgICAgICAgICB1c2VGYWN0b3J5ID0gcHJvcFZhbHVlO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChwcm9wTmFtZSA9PT0gJ3Byb3ZpZGVkSW4nICYmIHByb3BWYWx1ZSkge1xuICAgICAgICAgICAgICBwcm92aWRlZEluID0gcHJvcFZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKGZvckVudGl0eSAmJiB1c2VGYWN0b3J5ICYmIHByb3ZpZGVkSW4pIHtcbiAgICAgICAgICBlbnRpdGllcy5wdXNoKHtcbiAgICAgICAgICAgIG5hbWU6IGZvckVudGl0eSxcbiAgICAgICAgICAgIHNjaGVtYVRva2VuOiBgJHtmb3JFbnRpdHl9U2NoZW1hYCxcbiAgICAgICAgICAgIHNjaGVtYUZhY3Rvcnk6IHVzZUZhY3RvcnksXG4gICAgICAgICAgICBzY2hlbWFJbXBvcnRQYXRoOiBmaW5kSW1wb3J0UGF0aEZvcklkZW50aWZpZXIoc291cmNlRmlsZSwgdXNlRmFjdG9yeSksXG4gICAgICAgICAgICBwcm92aWRlZEluOiBwcm92aWRlZEluXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gZXh0cmFjdE1vZHVsZVJlZ2lzdHJhdGlvbnMoc291cmNlRmlsZTogU291cmNlRmlsZSwgbW9kdWxlczogTW9kdWxlSW5mb1tdKTogdm9pZCB7XG4gIC8vIEZpbmQgRElDb250YWluZXIuUk9PVC5tb2R1bGUoTW9kdWxlTmFtZSkgY2FsbHNcbiAgY29uc3QgY2FsbEV4cHJlc3Npb25zID0gc291cmNlRmlsZS5nZXREZXNjZW5kYW50c09mS2luZChTeW50YXhLaW5kLkNhbGxFeHByZXNzaW9uKTtcbiAgXG4gIGZvciAoY29uc3QgY2FsbEV4cHIgb2YgY2FsbEV4cHJlc3Npb25zKSB7XG4gICAgY29uc3QgZXhwcmVzc2lvbiA9IGNhbGxFeHByLmdldEV4cHJlc3Npb24oKTtcbiAgICBcbiAgICAvLyBDaGVjayBpZiBpdCdzIGEgcHJvcGVydHkgYWNjZXNzIGV4cHJlc3Npb24gbGlrZSBESUNvbnRhaW5lci5ST09ULm1vZHVsZVxuICAgIGlmIChleHByZXNzaW9uLmdldEtpbmQoKSA9PT0gU3ludGF4S2luZC5Qcm9wZXJ0eUFjY2Vzc0V4cHJlc3Npb24pIHtcbiAgICAgIGNvbnN0IHByb3BBY2Nlc3MgPSBleHByZXNzaW9uLmFzS2luZE9yVGhyb3coU3ludGF4S2luZC5Qcm9wZXJ0eUFjY2Vzc0V4cHJlc3Npb24pO1xuICAgICAgaWYgKHByb3BBY2Nlc3MuZ2V0VGV4dCgpLmluY2x1ZGVzKCdESUNvbnRhaW5lci5ST09ULm1vZHVsZScpIHx8IFxuICAgICAgICAgIHByb3BBY2Nlc3MuZ2V0VGV4dCgpLmVuZHNXaXRoKCcubW9kdWxlJykpIHtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGFyZ3MgPSBjYWxsRXhwci5nZXRBcmd1bWVudHMoKTtcbiAgICAgICAgaWYgKGFyZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IG1vZHVsZU5hbWUgPSBhcmdzWzBdLmdldFRleHQoKTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBGaW5kIGV4aXN0aW5nIG1vZHVsZSBvciBjcmVhdGUgbmV3IG9uZVxuICAgICAgICAgIGxldCBtb2R1bGVJbmZvID0gbW9kdWxlcy5maW5kKG0gPT4gbS5uYW1lID09PSBtb2R1bGVOYW1lKTtcbiAgICAgICAgICBpZiAoIW1vZHVsZUluZm8pIHtcbiAgICAgICAgICAgIG1vZHVsZUluZm8gPSB7XG4gICAgICAgICAgICAgIG5hbWU6IG1vZHVsZU5hbWUsXG4gICAgICAgICAgICAgIGNsYXNzTmFtZTogbW9kdWxlTmFtZSxcbiAgICAgICAgICAgICAgaW1wb3J0UGF0aDogZmluZEltcG9ydFBhdGhGb3JJZGVudGlmaWVyKHNvdXJjZUZpbGUsIG1vZHVsZU5hbWUpLFxuICAgICAgICAgICAgICBoYXNSdW50aW1lUHJvdmlkZXJzOiB0cnVlLFxuICAgICAgICAgICAgICBkZXBlbmRlbmNpZXM6IFtdXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgbW9kdWxlcy5wdXNoKG1vZHVsZUluZm8pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBmaW5kSW1wb3J0UGF0aEZvcklkZW50aWZpZXIoc291cmNlRmlsZTogU291cmNlRmlsZSwgaWRlbnRpZmllcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gRmluZCBpbXBvcnQgZGVjbGFyYXRpb24gdGhhdCBpbXBvcnRzIHRoaXMgaWRlbnRpZmllclxuICBjb25zdCBpbXBvcnREZWNsYXJhdGlvbnMgPSBzb3VyY2VGaWxlLmdldEltcG9ydERlY2xhcmF0aW9ucygpO1xuICBcbiAgZm9yIChjb25zdCBpbXBvcnREZWNsIG9mIGltcG9ydERlY2xhcmF0aW9ucykge1xuICAgIGNvbnN0IG5hbWVkSW1wb3J0cyA9IGltcG9ydERlY2wuZ2V0TmFtZWRJbXBvcnRzKCk7XG4gICAgZm9yIChjb25zdCBuYW1lZEltcG9ydCBvZiBuYW1lZEltcG9ydHMpIHtcbiAgICAgIGlmIChuYW1lZEltcG9ydC5nZXROYW1lKCkgPT09IGlkZW50aWZpZXIpIHtcbiAgICAgICAgbGV0IGltcG9ydFBhdGggPSBpbXBvcnREZWNsLmdldE1vZHVsZVNwZWNpZmllclZhbHVlKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBDb252ZXJ0IHJlbGF0aXZlIGltcG9ydHMgdG8gYWJzb2x1dGUgcGF0aHMgZnJvbSBwcm9qZWN0IHJvb3RcbiAgICAgICAgaWYgKGltcG9ydFBhdGguc3RhcnRzV2l0aCgnLi8nKSkge1xuICAgICAgICAgIGltcG9ydFBhdGggPSBpbXBvcnRQYXRoLnJlcGxhY2UoJy4vJywgJ3NyYy8nKTtcbiAgICAgICAgfSBlbHNlIGlmIChpbXBvcnRQYXRoLnN0YXJ0c1dpdGgoJy4uLycpKSB7XG4gICAgICAgICAgLy8gSGFuZGxlIC4uLyBwYXRocyBpZiBuZWVkZWRcbiAgICAgICAgICBpbXBvcnRQYXRoID0gaW1wb3J0UGF0aC5yZXBsYWNlKCcuLi8nLCAnJyk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIEVuc3VyZSAudHMgZXh0ZW5zaW9uXG4gICAgICAgIGlmICghaW1wb3J0UGF0aC5lbmRzV2l0aCgnLnRzJykgJiYgIWltcG9ydFBhdGguc3RhcnRzV2l0aCgnQCcpKSB7XG4gICAgICAgICAgaW1wb3J0UGF0aCArPSAnLnRzJztcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGltcG9ydFBhdGg7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIFxuICAvLyBGYWxsYmFjayB0byByZWFzb25hYmxlIGd1ZXNzIHdpdGggY29ycmVjdCBwYXRoc1xuICBpZiAoaWRlbnRpZmllci5pbmNsdWRlcygnY3JlYXRlJykgJiYgaWRlbnRpZmllci5pbmNsdWRlcygnU2NoZW1hJykpIHtcbiAgICBjb25zdCBlbnRpdHlOYW1lID0gaWRlbnRpZmllci5yZXBsYWNlKCdjcmVhdGUnLCAnJykucmVwbGFjZSgnU2NoZW1hJywgJycpO1xuICAgIC8vIENvbnZlcnQgUGFzY2FsQ2FzZSB0byBrZWJhYi1jYXNlIGZvciBmaWxlIG5hbWVzXG4gICAgY29uc3QgZmlsZU5hbWUgPSBlbnRpdHlOYW1lLnJlcGxhY2UoLyhbQS1aXSkvZywgKF9tYXRjaCwgcDEsIG9mZnNldCkgPT4gXG4gICAgICBvZmZzZXQgPiAwID8gJy0nICsgcDEudG9Mb3dlckNhc2UoKSA6IHAxLnRvTG93ZXJDYXNlKClcbiAgICApO1xuICAgIHJldHVybiBgc3JjL2VudGl0aWVzLyR7ZmlsZU5hbWV9LnNjaGVtYS50c2A7XG4gIH1cbiAgXG4gIGlmIChpZGVudGlmaWVyLmluY2x1ZGVzKCdNb2R1bGUnKSkge1xuICAgIHJldHVybiBgQHRlbjI0Z3JvdXAvZncyNC0ke2lkZW50aWZpZXIucmVwbGFjZSgnTW9kdWxlJywgJycpLnRvTG93ZXJDYXNlKCl9YDtcbiAgfVxuICBcbiAgcmV0dXJuIGBzcmMvdW5rbm93bi1pbXBvcnQtJHtpZGVudGlmaWVyfS50c2A7XG59XG4iXX0=