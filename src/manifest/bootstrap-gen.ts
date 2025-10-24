import { mkdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { Project, SourceFile, SyntaxKind, VariableDeclarationKind, Scope } from 'ts-morph';
import { CapabilityDescriptor, DeploymentUnitDescriptor, Manifest } from './types';
import { DUMappingResult } from './du-mapping';
import { analyzeRealDUDependencies, RealDUDependencies } from './real-dependency-analysis';

export interface BootstrapGenOptions {
  outputDir: string; // .fw24/.generated
  rootDir: string;   // project root
}

export function generateDUBootstraps(
  manifest: Manifest, 
  mapping: DUMappingResult, 
  options: BootstrapGenOptions
): void {
  const { outputDir, rootDir } = options;
  
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Create ts-morph project for AST-based code generation
  const project = new Project({
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
    const filePath = join(outputDir, `du-${du.name}.bootstrap.ts`);
    
    // Generate bootstrap file using ts-morph AST
    generateBootstrapFileWithTsMorph(project, du, capabilities, manifest, filePath, rootDir);
  }
}

function getCapabilitiesForDU(
  allCapabilities: CapabilityDescriptor[],
  du: DeploymentUnitDescriptor,
  capabilityToDU: Map<string, string>
): CapabilityDescriptor[] {
  return allCapabilities.filter(cap => capabilityToDU.get(cap.id) === du.name);
}

function generateBootstrapFileWithTsMorph(
  project: Project,
  du: DeploymentUnitDescriptor,
  capabilities: CapabilityDescriptor[],
  manifest: Manifest,
  filePath: string,
  rootDir: string
): void {
  // Analyze dependencies for this DU using real framework patterns
  const dependencies = analyzeRealDUDependencies(du.name, capabilities, manifest, rootDir);
  
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

function addImports(
  sourceFile: SourceFile, 
  dependencies: RealDUDependencies,
  manifest: Manifest,
  rootDir: string,
  bootstrapFilePath: string
): void {
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
    } else {
      // Local module - calculate relative path
      const relativePath = calculateRelativeImportPath(bootstrapFilePath, join(rootDir, module.importPath));
      sourceFile.addImportDeclaration({
        moduleSpecifier: relativePath,
        namedImports: [module.className]
      });
    }
  }
  
  // Import entity schema factories
  for (const entity of dependencies.entities) {
    const relativePath = calculateRelativeImportPath(bootstrapFilePath, join(rootDir, entity.schemaImportPath));
    sourceFile.addImportDeclaration({
      moduleSpecifier: relativePath,
      namedImports: [entity.schemaFactory]
    });
  }
  
  // Import controllers
  for (const controller of dependencies.controllers) {
    const relativePath = calculateRelativeImportPath(bootstrapFilePath, join(rootDir, controller.importPath));
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
        .map(p => p.useClassToken!);
      
      if (serviceClassNames.length > 0) {
        // Find service imports - they're typically in src/services/
        for (const serviceName of serviceClassNames) {
          // Convert service class name to likely file path
          const servicePath = `src/services/${serviceName.replace('Service', '').toLowerCase()}`;
          const relativePath = calculateRelativeImportPath(bootstrapFilePath, join(rootDir, servicePath));
          sourceFile.addImportDeclaration({
            moduleSpecifier: relativePath,
            namedImports: [serviceName]
          });
        }
      }
    }
  }
}

function addSetupDIFunction(sourceFile: SourceFile, dependencies: RealDUDependencies): void {
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

function addHandlerFunction(sourceFile: SourceFile, du: DeploymentUnitDescriptor, dependencies: RealDUDependencies): void {
  if (du.kind === 'api') {
    addAPIHandler(sourceFile, dependencies);
  } else {
    addWorkerHandler(sourceFile, dependencies);
  }
}

function addAPIHandler(sourceFile: SourceFile, dependencies: RealDUDependencies): void {
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

function addWorkerHandler(sourceFile: SourceFile, dependencies: RealDUDependencies): void {
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

function calculateRelativeImportPath(fromFile: string, toFile: string): string {
  // Get the directory of the from file
  const fromDir = fromFile.replace(/[^/]+$/, '');
  
  // Remove .ts extension from target file
  const cleanToFile = toFile.replace(/\.ts$/, '');
  
  // Calculate relative path
  let relativePath = relative(fromDir, cleanToFile);
  
  // Ensure relative paths start with './' or '../'
  if (!relativePath.startsWith('.')) {
    relativePath = './' + relativePath;
  }
  
  return relativePath;
}
