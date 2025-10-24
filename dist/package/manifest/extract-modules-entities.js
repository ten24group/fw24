"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractModulesAndEntities = extractModulesAndEntities;
const fs_1 = require("fs");
const path_1 = require("path");
const ts_morph_1 = require("ts-morph");
/**
 * Extract modules and entities from application source code using AST analysis
 * This populates the manifest.modules[] and manifest.entities[] arrays properly
 */
function extractModulesAndEntities(rootDir) {
    const modules = [];
    const entities = [];
    // Analyze the main DI file (src/di.ts)
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
        // Extract @DIModule decorated classes and external module registrations
        extractModulesFromDI(sourceFile, modules, rootDir);
        // Extract entity schemas with proper module scoping
        extractEntitiesFromDI(sourceFile, entities);
    }
    return { modules, entities };
}
function extractModulesFromDI(sourceFile, modules, _rootDir) {
    // 1. Find @DIModule decorated classes (local modules)
    const classes = sourceFile.getClasses();
    for (const classDecl of classes) {
        const diModuleDecorator = classDecl.getDecorator('DIModule');
        if (diModuleDecorator) {
            const moduleName = classDecl.getName();
            if (moduleName) {
                const appModule = {
                    name: moduleName,
                    path: 'src/di.ts',
                    runtime: {
                        providers: extractServiceProviders(sourceFile),
                        entities: [],
                        capabilities: [],
                        tags: []
                    }
                };
                modules.push(appModule);
            }
        }
    }
    // 2. Find external module registrations like DIContainer.ROOT.module(AuthModule)
    const callExpressions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.CallExpression);
    for (const callExpr of callExpressions) {
        const expression = callExpr.getExpression();
        if (expression.getKind() === ts_morph_1.SyntaxKind.PropertyAccessExpression) {
            const propAccess = expression.asKindOrThrow(ts_morph_1.SyntaxKind.PropertyAccessExpression);
            if (propAccess.getText().includes('DIContainer.ROOT.module')) {
                const args = callExpr.getArguments();
                if (args.length > 0) {
                    const moduleName = args[0].getText();
                    const importPath = findImportPathForIdentifier(sourceFile, moduleName);
                    // Only add if not already exists
                    if (!modules.find(m => m.name === moduleName)) {
                        modules.push({
                            name: moduleName,
                            path: importPath,
                            runtime: {
                                providers: [], // External modules - would need separate analysis
                                entities: [],
                                capabilities: [],
                                tags: []
                            }
                        });
                    }
                }
            }
        }
    }
}
function extractServiceProviders(sourceFile) {
    const providers = [];
    const callExpressions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.CallExpression);
    for (const callExpr of callExpressions) {
        const expression = callExpr.getExpression();
        // Look for AppDIContainer.register() calls
        if (expression.getKind() === ts_morph_1.SyntaxKind.PropertyAccessExpression) {
            const propAccess = expression.asKindOrThrow(ts_morph_1.SyntaxKind.PropertyAccessExpression);
            if (propAccess.getText().includes('register') &&
                (propAccess.getText().includes('AppDIContainer') || propAccess.getText().includes('container'))) {
                const args = callExpr.getArguments();
                if (args.length > 0 && args[0].getKind() === ts_morph_1.SyntaxKind.ObjectLiteralExpression) {
                    const objLiteral = args[0].asKindOrThrow(ts_morph_1.SyntaxKind.ObjectLiteralExpression);
                    let type = '';
                    let forEntity = '';
                    let useClass = '';
                    let provide = '';
                    // Extract properties from registration object
                    for (const prop of objLiteral.getProperties()) {
                        if (prop.getKind() === ts_morph_1.SyntaxKind.PropertyAssignment) {
                            const propAssignment = prop.asKindOrThrow(ts_morph_1.SyntaxKind.PropertyAssignment);
                            const propName = propAssignment.getName();
                            const propValue = propAssignment.getInitializer()?.getText();
                            if (propName === 'type' && propValue) {
                                type = propValue.replace(/['"]/g, '');
                            }
                            else if (propName === 'forEntity' && propValue) {
                                forEntity = propValue.replace(/['"]/g, '');
                            }
                            else if (propName === 'useClass' && propValue) {
                                useClass = propValue;
                            }
                            else if (propName === 'provide' && propValue) {
                                provide = propValue;
                            }
                        }
                    }
                    if (type && useClass && provide) {
                        providers.push({
                            provide: provide,
                            kind: type === 'service' ? 'service' : 'other',
                            forEntity: forEntity || undefined,
                            useClassToken: useClass,
                            priority: 0,
                            tags: []
                        });
                    }
                }
            }
        }
    }
    return providers;
}
function extractEntitiesFromDI(sourceFile, entities) {
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
                        const propValue = propAssignment.getInitializer()?.getText();
                        if (propName === 'forEntity' && propValue) {
                            forEntity = propValue.replace(/['"]/g, '');
                        }
                        else if (propName === 'useFactory' && propValue) {
                            useFactory = propValue;
                        }
                        else if (propName === 'providedIn' && propValue) {
                            // providedIn can be a module class reference like AppModule
                            providedIn = propValue;
                        }
                    }
                }
                if (forEntity && useFactory) {
                    entities.push({
                        name: forEntity,
                        schemaProviderToken: useFactory,
                        variants: [],
                        tags: []
                    });
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
                // Ensure .ts extension for local files
                if (!importPath.endsWith('.ts') && !importPath.startsWith('@')) {
                    importPath += '.ts';
                }
                return importPath;
            }
        }
    }
    // Fallback for external modules
    if (identifier.includes('Module')) {
        return `@ten24group/fw24-${identifier.replace('Module', '').toLowerCase()}`;
    }
    return `src/unknown-import-${identifier}.ts`;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXh0cmFjdC1tb2R1bGVzLWVudGl0aWVzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL21hbmlmZXN0L2V4dHJhY3QtbW9kdWxlcy1lbnRpdGllcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQWNBLDhEQXlCQztBQXRDRCwyQkFBZ0M7QUFDaEMsK0JBQTRCO0FBQzVCLHVDQUErRjtBQU8vRjs7O0dBR0c7QUFDSCxTQUFnQix5QkFBeUIsQ0FBQyxPQUFlO0lBQ3ZELE1BQU0sT0FBTyxHQUF1QixFQUFFLENBQUM7SUFDdkMsTUFBTSxRQUFRLEdBQXVCLEVBQUUsQ0FBQztJQUV4Qyx1Q0FBdUM7SUFDdkMsTUFBTSxVQUFVLEdBQUcsSUFBQSxXQUFJLEVBQUMsT0FBTyxFQUFFLFdBQVcsQ0FBQyxDQUFDO0lBQzlDLElBQUksSUFBQSxlQUFVLEVBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztRQUMzQixNQUFNLE9BQU8sR0FBRyxJQUFJLGtCQUFPLENBQUM7WUFDMUIscUJBQXFCLEVBQUUsS0FBSztZQUM1QixlQUFlLEVBQUU7Z0JBQ2YsWUFBWSxFQUFFLElBQUk7Z0JBQ2xCLG1CQUFtQixFQUFFLElBQUk7YUFDMUI7U0FDRixDQUFDLENBQUM7UUFFSCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsbUJBQW1CLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFM0Qsd0VBQXdFO1FBQ3hFLG9CQUFvQixDQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFFbkQsb0RBQW9EO1FBQ3BELHFCQUFxQixDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQztJQUM5QyxDQUFDO0lBRUQsT0FBTyxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsQ0FBQztBQUMvQixDQUFDO0FBRUQsU0FBUyxvQkFBb0IsQ0FBQyxVQUFzQixFQUFFLE9BQTJCLEVBQUUsUUFBZ0I7SUFDakcsc0RBQXNEO0lBQ3RELE1BQU0sT0FBTyxHQUFHLFVB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LENBQUMsRUFBRSxDQUFDO29CQUN4Qyw2QkFBNkI7b0JBQzdCLFVBQVUsR0FBRyxVQUFVLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDN0MsQ0FBQztnQkFFRCx1Q0FBdUM7Z0JBQ3ZDLElBQUksQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO29CQUMvRCxVQUFVLElBQUksS0FBSyxDQUFDO2dCQUN0QixDQUFDO2dCQUVELE9BQU8sVUFBVSxDQUFDO1lBQ3BCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELGdDQUFnQztJQUNoQyxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztRQUNsQyxPQUFPLG9CQUFvQixVQUFVLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDO0lBQzlFLENBQUM7SUFFRCxPQUFPLHNCQUFzQixVQUFVLEtBQUssQ0FBQztBQUMvQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTW9kdWxlRGVzY3JpcHRvciwgRW50aXR5RGVzY3JpcHRvciwgUHJvdmlkZXJEZXNjcmlwdG9yIH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSAnZnMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgUHJvamVjdCwgU291cmNlRmlsZSwgU3ludGF4S2luZCwgQ2FsbEV4cHJlc3Npb24sIFByb3BlcnR5QXNzaWdubWVudCB9IGZyb20gJ3RzLW1vcnBoJztcblxuZXhwb3J0IGludGVyZmFjZSBNb2R1bGVFeHRyYWN0aW9uUmVzdWx0IHtcbiAgbW9kdWxlczogTW9kdWxlRGVzY3JpcHRvcltdO1xuICBlbnRpdGllczogRW50aXR5RGVzY3JpcHRvcltdO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgbW9kdWxlcyBhbmQgZW50aXRpZXMgZnJvbSBhcHBsaWNhdGlvbiBzb3VyY2UgY29kZSB1c2luZyBBU1QgYW5hbHlzaXNcbiAqIFRoaXMgcG9wdWxhdGVzIHRoZSBtYW5pZmVzdC5tb2R1bGVzW10gYW5kIG1hbmlmZXN0LmVudGl0aWVzW10gYXJyYXlzIHByb3Blcmx5XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0TW9kdWxlc0FuZEVudGl0aWVzKHJvb3REaXI6IHN0cmluZyk6IE1vZHVsZUV4dHJhY3Rpb25SZXN1bHQge1xuICBjb25zdCBtb2R1bGVzOiBNb2R1bGVEZXNjcmlwdG9yW10gPSBbXTtcbiAgY29uc3QgZW50aXRpZXM6IEVudGl0eURlc2NyaXB0b3JbXSA9IFtdO1xuXG4gIC8vIEFuYWx5emUgdGhlIG1haW4gREkgZmlsZSAoc3JjL2RpLnRzKVxuICBjb25zdCBkaUZpbGVQYXRoID0gam9pbihyb290RGlyLCAnc3JjL2RpLnRzJyk7XG4gIGlmIChleGlzdHNTeW5jKGRpRmlsZVBhdGgpKSB7XG4gICAgY29uc3QgcHJvamVjdCA9IG5ldyBQcm9qZWN0KHtcbiAgICAgIHVzZUluTWVtb3J5RmlsZVN5c3RlbTogZmFsc2UsXG4gICAgICBjb21waWxlck9wdGlvbnM6IHtcbiAgICAgICAgc2tpcExpYkNoZWNrOiB0cnVlLFxuICAgICAgICBza2lwRGVmYXVsdExpYkNoZWNrOiB0cnVlXG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgY29uc3Qgc291cmNlRmlsZSA9IHByb2plY3QuYWRkU291cmNlRmlsZUF0UGF0aChkaUZpbGVQYXRoKTtcbiAgICBcbiAgICAvLyBFeHRyYWN0IEBESU1vZHVsZSBkZWNvcmF0ZWQgY2xhc3NlcyBhbmQgZXh0ZXJuYWwgbW9kdWxlIHJlZ2lzdHJhdGlvbnNcbiAgICBleHRyYWN0TW9kdWxlc0Zyb21ESShzb3VyY2VGaWxlLCBtb2R1bGVzLCByb290RGlyKTtcbiAgICBcbiAgICAvLyBFeHRyYWN0IGVudGl0eSBzY2hlbWFzIHdpdGggcHJvcGVyIG1vZHVsZSBzY29waW5nXG4gICAgZXh0cmFjdEVudGl0aWVzRnJvbURJKHNvdXJjZUZpbGUsIGVudGl0aWVzKTtcbiAgfVxuXG4gIHJldHVybiB7IG1vZHVsZXMsIGVudGl0aWVzIH07XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RNb2R1bGVzRnJvbURJKHNvdXJjZUZpbGU6IFNvdXJjZUZpbGUsIG1vZHVsZXM6IE1vZHVsZURlc2NyaXB0b3JbXSwgX3Jvb3REaXI6IHN0cmluZyk6IHZvaWQge1xuICAvLyAxLiBGaW5kIEBESU1vZHVsZSBkZWNvcmF0ZWQgY2xhc3NlcyAobG9jYWwgbW9kdWxlcylcbiAgY29uc3QgY2xhc3NlcyA9IHNvdXJjZUZpbGUuZ2V0Q2xhc3NlcygpO1xuICBmb3IgKGNvbnN0IGNsYXNzRGVjbCBvZiBjbGFzc2VzKSB7XG4gICAgY29uc3QgZGlNb2R1bGVEZWNvcmF0b3IgPSBjbGFzc0RlY2wuZ2V0RGVjb3JhdG9yKCdESU1vZHVsZScpO1xuICAgIGlmIChkaU1vZHVsZURlY29yYXRvcikge1xuICAgICAgY29uc3QgbW9kdWxlTmFtZSA9IGNsYXNzRGVjbC5nZXROYW1lKCk7XG4gICAgICBpZiAobW9kdWxlTmFtZSkge1xuICAgICAgICBjb25zdCBhcHBNb2R1bGUgPSB7XG4gICAgICAgICAgbmFtZTogbW9kdWxlTmFtZSxcbiAgICAgICAgICBwYXRoOiAnc3JjL2RpLnRzJyxcbiAgICAgICAgICBydW50aW1lOiB7XG4gICAgICAgICAgICBwcm92aWRlcnM6IGV4dHJhY3RTZXJ2aWNlUHJvdmlkZXJzKHNvdXJjZUZpbGUpLFxuICAgICAgICAgICAgZW50aXRpZXM6IFtdLFxuICAgICAgICAgICAgY2FwYWJpbGl0aWVzOiBbXSxcbiAgICAgICAgICAgIHRhZ3M6IFtdXG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICBtb2R1bGVzLnB1c2goYXBwTW9kdWxlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyAyLiBGaW5kIGV4dGVybmFsIG1vZHVsZSByZWdpc3RyYXRpb25zIGxpa2UgRElDb250YWluZXIuUk9PVC5tb2R1bGUoQXV0aE1vZHVsZSlcbiAgY29uc3QgY2FsbEV4cHJlc3Npb25zID0gc291cmNlRmlsZS5nZXREZXNjZW5kYW50c09mS2luZChTeW50YXhLaW5kLkNhbGxFeHByZXNzaW9uKTtcbiAgZm9yIChjb25zdCBjYWxsRXhwciBvZiBjYWxsRXhwcmVzc2lvbnMpIHtcbiAgICBjb25zdCBleHByZXNzaW9uID0gY2FsbEV4cHIuZ2V0RXhwcmVzc2lvbigpO1xuICAgIGlmIChleHByZXNzaW9uLmdldEtpbmQoKSA9PT0gU3ludGF4S2luZC5Qcm9wZXJ0eUFjY2Vzc0V4cHJlc3Npb24pIHtcbiAgICAgIGNvbnN0IHByb3BBY2Nlc3MgPSBleHByZXNzaW9uLmFzS2luZE9yVGhyb3coU3ludGF4S2luZC5Qcm9wZXJ0eUFjY2Vzc0V4cHJlc3Npb24pO1xuICAgICAgaWYgKHByb3BBY2Nlc3MuZ2V0VGV4dCgpLmluY2x1ZGVzKCdESUNvbnRhaW5lci5ST09ULm1vZHVsZScpKSB7XG4gICAgICAgIGNvbnN0IGFyZ3MgPSBjYWxsRXhwci5nZXRBcmd1bWVudHMoKTtcbiAgICAgICAgaWYgKGFyZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IG1vZHVsZU5hbWUgPSBhcmdzWzBdLmdldFRleHQoKTtcbiAgICAgICAgICBjb25zdCBpbXBvcnRQYXRoID0gZmluZEltcG9ydFBhdGhGb3JJZGVudGlmaWVyKHNvdXJjZUZpbGUsIG1vZHVsZU5hbWUpO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIE9ubHkgYWRkIGlmIG5vdCBhbHJlYWR5IGV4aXN0c1xuICAgICAgICAgIGlmICghbW9kdWxlcy5maW5kKG0gPT4gbS5uYW1lID09PSBtb2R1bGVOYW1lKSkge1xuICAgICAgICAgICAgbW9kdWxlcy5wdXNoKHtcbiAgICAgICAgICAgICAgbmFtZTogbW9kdWxlTmFtZSxcbiAgICAgICAgICAgICAgcGF0aDogaW1wb3J0UGF0aCxcbiAgICAgICAgICAgICAgcnVudGltZToge1xuICAgICAgICAgICAgICAgIHByb3ZpZGVyczogW10sIC8vIEV4dGVybmFsIG1vZHVsZXMgLSB3b3VsZCBuZWVkIHNlcGFyYXRlIGFuYWx5c2lzXG4gICAgICAgICAgICAgICAgZW50aXRpZXM6IFtdLFxuICAgICAgICAgICAgICAgIGNhcGFiaWxpdGllczogW10sXG4gICAgICAgICAgICAgICAgdGFnczogW11cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RTZXJ2aWNlUHJvdmlkZXJzKHNvdXJjZUZpbGU6IFNvdXJjZUZpbGUpOiBQcm92aWRlckRlc2NyaXB0b3JbXSB7XG4gIGNvbnN0IHByb3ZpZGVyczogUHJvdmlkZXJEZXNjcmlwdG9yW10gPSBbXTtcbiAgY29uc3QgY2FsbEV4cHJlc3Npb25zID0gc291cmNlRmlsZS5nZXREZXNjZW5kYW50c09mS2luZChTeW50YXhLaW5kLkNhbGxFeHByZXNzaW9uKTtcbiAgXG4gIGZvciAoY29uc3QgY2FsbEV4cHIgb2YgY2FsbEV4cHJlc3Npb25zKSB7XG4gICAgY29uc3QgZXhwcmVzc2lvbiA9IGNhbGxFeHByLmdldEV4cHJlc3Npb24oKTtcbiAgICBcbiAgICAvLyBMb29rIGZvciBBcHBESUNvbnRhaW5lci5yZWdpc3RlcigpIGNhbGxzXG4gICAgaWYgKGV4cHJlc3Npb24uZ2V0S2luZCgpID09PSBTeW50YXhLaW5kLlByb3BlcnR5QWNjZXNzRXhwcmVzc2lvbikge1xuICAgICAgY29uc3QgcHJvcEFjY2VzcyA9IGV4cHJlc3Npb24uYXNLaW5kT3JUaHJvdyhTeW50YXhLaW5kLlByb3BlcnR5QWNjZXNzRXhwcmVzc2lvbik7XG4gICAgICBpZiAocHJvcEFjY2Vzcy5nZXRUZXh0KCkuaW5jbHVkZXMoJ3JlZ2lzdGVyJykgJiYgXG4gICAgICAgICAgKHByb3BBY2Nlc3MuZ2V0VGV4dCgpLmluY2x1ZGVzKCdBcHBESUNvbnRhaW5lcicpIHx8IHByb3BBY2Nlc3MuZ2V0VGV4dCgpLmluY2x1ZGVzKCdjb250YWluZXInKSkpIHtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGFyZ3MgPSBjYWxsRXhwci5nZXRBcmd1bWVudHMoKTtcbiAgICAgICAgaWYgKGFyZ3MubGVuZ3RoID4gMCAmJiBhcmdzWzBdLmdldEtpbmQoKSA9PT0gU3ludGF4S2luZC5PYmplY3RMaXRlcmFsRXhwcmVzc2lvbikge1xuICAgICAgICAgIGNvbnN0IG9iakxpdGVyYWwgPSBhcmdzWzBdLmFzS2luZE9yVGhyb3coU3ludGF4S2luZC5PYmplY3RMaXRlcmFsRXhwcmVzc2lvbik7XG4gICAgICAgICAgXG4gICAgICAgICAgbGV0IHR5cGUgPSAnJztcbiAgICAgICAgICBsZXQgZm9yRW50aXR5ID0gJyc7XG4gICAgICAgICAgbGV0IHVzZUNsYXNzID0gJyc7XG4gICAgICAgICAgbGV0IHByb3ZpZGUgPSAnJztcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBFeHRyYWN0IHByb3BlcnRpZXMgZnJvbSByZWdpc3RyYXRpb24gb2JqZWN0XG4gICAgICAgICAgZm9yIChjb25zdCBwcm9wIG9mIG9iakxpdGVyYWwuZ2V0UHJvcGVydGllcygpKSB7XG4gICAgICAgICAgICBpZiAocHJvcC5nZXRLaW5kKCkgPT09IFN5bnRheEtpbmQuUHJvcGVydHlBc3NpZ25tZW50KSB7XG4gICAgICAgICAgICAgIGNvbnN0IHByb3BBc3NpZ25tZW50ID0gcHJvcC5hc0tpbmRPclRocm93KFN5bnRheEtpbmQuUHJvcGVydHlBc3NpZ25tZW50KTtcbiAgICAgICAgICAgICAgY29uc3QgcHJvcE5hbWUgPSBwcm9wQXNzaWdubWVudC5nZXROYW1lKCk7XG4gICAgICAgICAgICAgIGNvbnN0IHByb3BWYWx1ZSA9IHByb3BBc3NpZ25tZW50LmdldEluaXRpYWxpemVyKCk/LmdldFRleHQoKTtcbiAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgIGlmIChwcm9wTmFtZSA9PT0gJ3R5cGUnICYmIHByb3BWYWx1ZSkge1xuICAgICAgICAgICAgICAgIHR5cGUgPSBwcm9wVmFsdWUucmVwbGFjZSgvWydcIl0vZywgJycpO1xuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHByb3BOYW1lID09PSAnZm9yRW50aXR5JyAmJiBwcm9wVmFsdWUpIHtcbiAgICAgICAgICAgICAgICBmb3JFbnRpdHkgPSBwcm9wVmFsdWUucmVwbGFjZSgvWydcIl0vZywgJycpO1xuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHByb3BOYW1lID09PSAndXNlQ2xhc3MnICYmIHByb3BWYWx1ZSkge1xuICAgICAgICAgICAgICAgIHVzZUNsYXNzID0gcHJvcFZhbHVlO1xuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHByb3BOYW1lID09PSAncHJvdmlkZScgJiYgcHJvcFZhbHVlKSB7XG4gICAgICAgICAgICAgICAgcHJvdmlkZSA9IHByb3BWYWx1ZTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBcbiAgICAgICAgICBpZiAodHlwZSAmJiB1c2VDbGFzcyAmJiBwcm92aWRlKSB7XG4gICAgICAgICAgICBwcm92aWRlcnMucHVzaCh7XG4gICAgICAgICAgICAgIHByb3ZpZGU6IHByb3ZpZGUsXG4gICAgICAgICAgICAgIGtpbmQ6IHR5cGUgPT09ICdzZXJ2aWNlJyA/ICdzZXJ2aWNlJyA6ICdvdGhlcicsXG4gICAgICAgICAgICAgIGZvckVudGl0eTogZm9yRW50aXR5IHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgdXNlQ2xhc3NUb2tlbjogdXNlQ2xhc3MsXG4gICAgICAgICAgICAgIHByaW9yaXR5OiAwLFxuICAgICAgICAgICAgICB0YWdzOiBbXVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG4gIFxuICByZXR1cm4gcHJvdmlkZXJzO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0RW50aXRpZXNGcm9tREkoc291cmNlRmlsZTogU291cmNlRmlsZSwgZW50aXRpZXM6IEVudGl0eURlc2NyaXB0b3JbXSk6IHZvaWQge1xuICBjb25zdCBjYWxsRXhwcmVzc2lvbnMgPSBzb3VyY2VGaWxlLmdldERlc2NlbmRhbnRzT2ZLaW5kKFN5bnRheEtpbmQuQ2FsbEV4cHJlc3Npb24pO1xuICBcbiAgZm9yIChjb25zdCBjYWxsRXhwciBvZiBjYWxsRXhwcmVzc2lvbnMpIHtcbiAgICBpZiAoY2FsbEV4cHIuZ2V0RXhwcmVzc2lvbigpLmdldFRleHQoKSA9PT0gJ3JlZ2lzdGVyRW50aXR5U2NoZW1hJykge1xuICAgICAgY29uc3QgYXJncyA9IGNhbGxFeHByLmdldEFyZ3VtZW50cygpO1xuICAgICAgaWYgKGFyZ3MubGVuZ3RoID4gMCAmJiBhcmdzWzBdLmdldEtpbmQoKSA9PT0gU3ludGF4S2luZC5PYmplY3RMaXRlcmFsRXhwcmVzc2lvbikge1xuICAgICAgICBjb25zdCBvYmpMaXRlcmFsID0gYXJnc1swXS5hc0tpbmRPclRocm93KFN5bnRheEtpbmQuT2JqZWN0TGl0ZXJhbEV4cHJlc3Npb24pO1xuICAgICAgICBcbiAgICAgICAgbGV0IGZvckVudGl0eSA9ICcnO1xuICAgICAgICBsZXQgdXNlRmFjdG9yeSA9ICcnO1xuICAgICAgICBsZXQgcHJvdmlkZWRJbiA9ICcnO1xuICAgICAgICBcbiAgICAgICAgLy8gRXh0cmFjdCBwcm9wZXJ0aWVzIGZyb20gb2JqZWN0IGxpdGVyYWxcbiAgICAgICAgZm9yIChjb25zdCBwcm9wIG9mIG9iakxpdGVyYWwuZ2V0UHJvcGVydGllcygpKSB7XG4gICAgICAgICAgaWYgKHByb3AuZ2V0S2luZCgpID09PSBTeW50YXhLaW5kLlByb3BlcnR5QXNzaWdubWVudCkge1xuICAgICAgICAgICAgY29uc3QgcHJvcEFzc2lnbm1lbnQgPSBwcm9wLmFzS2luZE9yVGhyb3coU3ludGF4S2luZC5Qcm9wZXJ0eUFzc2lnbm1lbnQpO1xuICAgICAgICAgICAgY29uc3QgcHJvcE5hbWUgPSBwcm9wQXNzaWdubWVudC5nZXROYW1lKCk7XG4gICAgICAgICAgICBjb25zdCBwcm9wVmFsdWUgPSBwcm9wQXNzaWdubWVudC5nZXRJbml0aWFsaXplcigpPy5nZXRUZXh0KCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChwcm9wTmFtZSA9PT0gJ2ZvckVudGl0eScgJiYgcHJvcFZhbHVlKSB7XG4gICAgICAgICAgICAgIGZvckVudGl0eSA9IHByb3BWYWx1ZS5yZXBsYWNlKC9bJ1wiXS9nLCAnJyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHByb3BOYW1lID09PSAndXNlRmFjdG9yeScgJiYgcHJvcFZhbHVlKSB7XG4gICAgICAgICAgICAgIHVzZUZhY3RvcnkgPSBwcm9wVmFsdWU7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHByb3BOYW1lID09PSAncHJvdmlkZWRJbicgJiYgcHJvcFZhbHVlKSB7XG4gICAgICAgICAgICAgIC8vIHByb3ZpZGVkSW4gY2FuIGJlIGEgbW9kdWxlIGNsYXNzIHJlZmVyZW5jZSBsaWtlIEFwcE1vZHVsZVxuICAgICAgICAgICAgICBwcm92aWRlZEluID0gcHJvcFZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKGZvckVudGl0eSAmJiB1c2VGYWN0b3J5KSB7XG4gICAgICAgICAgZW50aXRpZXMucHVzaCh7XG4gICAgICAgICAgICBuYW1lOiBmb3JFbnRpdHksXG4gICAgICAgICAgICBzY2hlbWFQcm92aWRlclRva2VuOiB1c2VGYWN0b3J5LFxuICAgICAgICAgICAgdmFyaWFudHM6IFtdLFxuICAgICAgICAgICAgdGFnczogW11cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBmaW5kSW1wb3J0UGF0aEZvcklkZW50aWZpZXIoc291cmNlRmlsZTogU291cmNlRmlsZSwgaWRlbnRpZmllcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gRmluZCBpbXBvcnQgZGVjbGFyYXRpb24gdGhhdCBpbXBvcnRzIHRoaXMgaWRlbnRpZmllclxuICBjb25zdCBpbXBvcnREZWNsYXJhdGlvbnMgPSBzb3VyY2VGaWxlLmdldEltcG9ydERlY2xhcmF0aW9ucygpO1xuICBcbiAgZm9yIChjb25zdCBpbXBvcnREZWNsIG9mIGltcG9ydERlY2xhcmF0aW9ucykge1xuICAgIGNvbnN0IG5hbWVkSW1wb3J0cyA9IGltcG9ydERlY2wuZ2V0TmFtZWRJbXBvcnRzKCk7XG4gICAgZm9yIChjb25zdCBuYW1lZEltcG9ydCBvZiBuYW1lZEltcG9ydHMpIHtcbiAgICAgIGlmIChuYW1lZEltcG9ydC5nZXROYW1lKCkgPT09IGlkZW50aWZpZXIpIHtcbiAgICAgICAgbGV0IGltcG9ydFBhdGggPSBpbXBvcnREZWNsLmdldE1vZHVsZVNwZWNpZmllclZhbHVlKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBDb252ZXJ0IHJlbGF0aXZlIGltcG9ydHMgdG8gYWJzb2x1dGUgcGF0aHMgZnJvbSBwcm9qZWN0IHJvb3RcbiAgICAgICAgaWYgKGltcG9ydFBhdGguc3RhcnRzV2l0aCgnLi8nKSkge1xuICAgICAgICAgIGltcG9ydFBhdGggPSBpbXBvcnRQYXRoLnJlcGxhY2UoJy4vJywgJ3NyYy8nKTtcbiAgICAgICAgfSBlbHNlIGlmIChpbXBvcnRQYXRoLnN0YXJ0c1dpdGgoJy4uLycpKSB7XG4gICAgICAgICAgLy8gSGFuZGxlIC4uLyBwYXRocyBpZiBuZWVkZWRcbiAgICAgICAgICBpbXBvcnRQYXRoID0gaW1wb3J0UGF0aC5yZXBsYWNlKCcuLi8nLCAnJyk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIEVuc3VyZSAudHMgZXh0ZW5zaW9uIGZvciBsb2NhbCBmaWxlc1xuICAgICAgICBpZiAoIWltcG9ydFBhdGguZW5kc1dpdGgoJy50cycpICYmICFpbXBvcnRQYXRoLnN0YXJ0c1dpdGgoJ0AnKSkge1xuICAgICAgICAgIGltcG9ydFBhdGggKz0gJy50cyc7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHJldHVybiBpbXBvcnRQYXRoO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBcbiAgLy8gRmFsbGJhY2sgZm9yIGV4dGVybmFsIG1vZHVsZXNcbiAgaWYgKGlkZW50aWZpZXIuaW5jbHVkZXMoJ01vZHVsZScpKSB7XG4gICAgcmV0dXJuIGBAdGVuMjRncm91cC9mdzI0LSR7aWRlbnRpZmllci5yZXBsYWNlKCdNb2R1bGUnLCAnJykudG9Mb3dlckNhc2UoKX1gO1xuICB9XG4gIFxuICByZXR1cm4gYHNyYy91bmtub3duLWltcG9ydC0ke2lkZW50aWZpZXJ9LnRzYDtcbn1cbiJdfQ==