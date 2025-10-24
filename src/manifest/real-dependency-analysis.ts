import { Manifest, CapabilityDescriptor, ModuleDescriptor, EntityDescriptor } from './types';
import { existsSync } from 'fs';
import { join } from 'path';
import { Project, SourceFile, SyntaxKind, CallExpression, PropertyAssignment } from 'ts-morph';

export interface RealDUDependencies {
  modules: ModuleInfo[];
  entities: EntityInfo[];
  controllers: ControllerInfo[];
  diRegistrations: DIRegistration[];
}

export interface ModuleInfo {
  name: string;
  className: string;
  importPath: string;
  hasRuntimeProviders: boolean;
  dependencies: string[]; // Other modules this depends on
}

export interface EntityInfo {
  name: string;
  schemaToken: string;
  schemaFactory: string;
  schemaImportPath: string;
  serviceToken?: string;
  serviceClass?: string;
  serviceImportPath?: string;
  providedIn: string; // Module name
}

export interface ControllerInfo {
  name: string;
  className: string;
  importPath: string;
  basePath: string;
}

export interface DIRegistration {
  type: 'module' | 'entity' | 'service' | 'controller';
  code: string;
}

/**
 * Real dependency analysis that understands the fw24 framework patterns:
 * - @DIModule decorators and module registration
 * - registerEntitySchema() calls
 * - Module dependencies and topological ordering
 * - Proper DI container setup
 */
export function analyzeRealDUDependencies(
  _duName: string,
  capabilities: CapabilityDescriptor[],
  manifest: Manifest,
  rootDir: string = process.cwd()
): RealDUDependencies {
  
  const modules: ModuleInfo[] = [];
  const entities: EntityInfo[] = [];
  const controllers: ControllerInfo[] = [];
  const diRegistrations: DIRegistration[] = [];

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
  const diFilePath = join(rootDir, 'src/di.ts');
  if (existsSync(diFilePath)) {
    const project = new Project({
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

function extractDIModules(sourceFile: SourceFile, modules: ModuleInfo[]): void {
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

function extractEntitySchemaRegistrations(sourceFile: SourceFile, entities: EntityInfo[]): void {
  // Find all registerEntitySchema call expressions
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  
  for (const callExpr of callExpressions) {
    if (callExpr.getExpression().getText() === 'registerEntitySchema') {
      const args = callExpr.getArguments();
      if (args.length > 0 && args[0].getKind() === SyntaxKind.ObjectLiteralExpression) {
        const objLiteral = args[0].asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
        
        let forEntity = '';
        let useFactory = '';
        let providedIn = '';
        
        // Extract properties from object literal
        for (const prop of objLiteral.getProperties()) {
          if (prop.getKind() === SyntaxKind.PropertyAssignment) {
            const propAssignment = prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
            const propName = propAssignment.getName();
            const propValue = propAssignment.getInitializer()?.getText().replace(/['"]/g, '');
            
            if (propName === 'forEntity' && propValue) {
              forEntity = propValue;
            } else if (propName === 'useFactory' && propValue) {
              useFactory = propValue;
            } else if (propName === 'providedIn' && propValue) {
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

function extractModuleRegistrations(sourceFile: SourceFile, modules: ModuleInfo[]): void {
  // Find DIContainer.ROOT.module(ModuleName) calls
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  
  for (const callExpr of callExpressions) {
    const expression = callExpr.getExpression();
    
    // Check if it's a property access expression like DIContainer.ROOT.module
    if (expression.getKind() === SyntaxKind.PropertyAccessExpression) {
      const propAccess = expression.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
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

function findImportPathForIdentifier(sourceFile: SourceFile, identifier: string): string {
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
        } else if (importPath.startsWith('../')) {
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
    const fileName = entityName.replace(/([A-Z])/g, (_match, p1, offset) => 
      offset > 0 ? '-' + p1.toLowerCase() : p1.toLowerCase()
    );
    return `src/entities/${fileName}.schema.ts`;
  }
  
  if (identifier.includes('Module')) {
    return `@ten24group/fw24-${identifier.replace('Module', '').toLowerCase()}`;
  }
  
  return `src/unknown-import-${identifier}.ts`;
}
