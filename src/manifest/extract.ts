import { Project, SourceFile, ClassDeclaration, Node, SyntaxKind } from 'ts-morph';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative } from 'path';
import { CapabilityDescriptor, CapabilityRoute, AuthorizerType, ResourceIntent } from './types';
import { translateResourceAccessToIntents, ResourceAccessConfig } from './translate';

export interface ExtractOptions {
  rootDir?: string;
  srcDirs?: string[];
  registriesDir?: string;
}

export function extractCapabilities(rootDir?: string) {
  const root = rootDir || process.cwd();
  const srcDirs = ['src'];

  const project = new Project({
    compilerOptions: {
      target: 99, // Latest
      module: 1, // CommonJS
      skipLibCheck: true,
      skipDefaultLibCheck: true,
    }
  });

  const capabilities: CapabilityDescriptor[] = [];
  const intents: ResourceIntent[] = [];

  for (const srcDir of srcDirs) {
    const srcPath = join(root, srcDir);
    if (!existsSync(srcPath)) continue;

    project.addSourceFilesAtPaths(join(srcPath, '**/*.ts'));
  }

  const sourceFiles = project.getSourceFiles();

  for (const sourceFile of sourceFiles) {
    extractFromFile(sourceFile, capabilities, intents, root);
  }

  return { capabilities, intents };
}

export function extractToRegistries(options: ExtractOptions = {}) {
  const root = options.rootDir || process.cwd();
  const srcDirs = options.srcDirs || ['src'];
  const registriesDir = options.registriesDir || join(root, '.fw24', 'registries');
  
  if (!existsSync(registriesDir)) mkdirSync(registriesDir, { recursive: true });

  const project = new Project({
    compilerOptions: {
      target: 99, // Latest
      module: 1, // CommonJS
      skipLibCheck: true,
      skipDefaultLibCheck: true,
    }
  });

  const capabilities: CapabilityDescriptor[] = [];
  const intents: ResourceIntent[] = [];

  for (const srcDir of srcDirs) {
    const fullSrcDir = join(root, srcDir);
    if (!existsSync(fullSrcDir)) continue;
    
    // Use glob to find files first, then add them to ts-morph
    const glob = require('glob');
    const patterns = [
      `${fullSrcDir}/**/controller*.ts`,
      `${fullSrcDir}/**/*controller*.ts`,
      `${fullSrcDir}/**/*.controller.ts`,
      `${fullSrcDir}/**/queue*.ts`,
      `${fullSrcDir}/**/*queue*.ts`,
      `${fullSrcDir}/**/*.queue.ts`,
      `${fullSrcDir}/**/task*.ts`,
      `${fullSrcDir}/**/*task*.ts`,
      `${fullSrcDir}/**/*.task.ts`
    ];
    
    const allFiles: string[] = [];
    for (const pattern of patterns) {
      const files = glob.sync(pattern);
      allFiles.push(...files);
    }
    
    // Remove duplicates
    const uniqueFiles = [...new Set(allFiles)];
    
    const controllerFiles = project.addSourceFilesAtPaths(uniqueFiles);
    
    for (const sourceFile of controllerFiles) {
      extractFromFile(sourceFile, capabilities, intents, root);
    }
  }

  // Write registries
  writeFileSync(join(registriesDir, 'capabilities.json'), JSON.stringify({ items: capabilities }, null, 2));
  writeFileSync(join(registriesDir, 'resource-intents.json'), JSON.stringify({ items: intents }, null, 2));
  
  // Write minimal other registries if they don't exist
  const appPath = join(registriesDir, 'app.json');
  if (!existsSync(appPath)) {
    writeFileSync(appPath, JSON.stringify({ app: { name: 'fw24-app', version: '1.0.0' } }, null, 2));
  }
  
  const modulesPath = join(registriesDir, 'modules.json');
  if (!existsSync(modulesPath)) {
    writeFileSync(modulesPath, JSON.stringify({ items: [] }, null, 2));
  }
  
  const entitiesPath = join(registriesDir, 'entities.json');
  if (!existsSync(entitiesPath)) {
    writeFileSync(entitiesPath, JSON.stringify({ items: [] }, null, 2));
  }
  
  const dusPath = join(registriesDir, 'deployment-units.json');
  if (!existsSync(dusPath)) {
    const defaultDUs = [
      { name: 'api', kind: 'api' as const, include: { capabilities: [{ kind: 'controller' as const }] } }
    ];
    writeFileSync(dusPath, JSON.stringify({ items: defaultDUs }, null, 2));
  }

  return { capabilities: capabilities.length, intents: intents.length };
}

function extractFromFile(sourceFile: SourceFile, capabilities: CapabilityDescriptor[], intents: ResourceIntent[], rootDir: string) {
  const filePath = relative(rootDir, sourceFile.getFilePath());
  
  for (const cls of sourceFile.getClasses()) {
    const controllerInfo = extractController(cls, filePath);
    if (controllerInfo) {
      capabilities.push(controllerInfo.capability);
      intents.push(...controllerInfo.intents);
    }
    
    const queueInfo = extractQueue(cls, filePath);
    if (queueInfo) {
      capabilities.push(queueInfo.capability);
      intents.push(...queueInfo.intents);
    }
    
    const taskInfo = extractTask(cls, filePath);
    if (taskInfo) {
      capabilities.push(taskInfo.capability);
      intents.push(...taskInfo.intents);
    }
  }
}

function extractController(cls: ClassDeclaration, filePath: string) {
  const controllerDec = cls.getDecorator('Controller');
  if (!controllerDec) return null;
  
  const args = controllerDec.getArguments();
  if (args.length === 0) return null;
  
  const nameArg = args[0];
  const configArg = args[1];
  
  const controllerName = nameArg.getKind() === SyntaxKind.StringLiteral ?
    nameArg.getText().slice(1, -1) : 'unknown';
  
  const config = configArg ? parseObjectLiteral(configArg) : {};
  
  const routes = extractRoutes(cls, config.authorizer);
  const intents = translateResourceAccessToIntents(config.resourceAccess);
  
  const capability: CapabilityDescriptor = {
    id: `${controllerName}:controller:${cls.getName()}`,
    kind: 'controller',
    sourceFile: filePath,
    exportName: cls.getName() || 'UnknownController',
    routing: {
      basePath: `/${controllerName}`,
      routes,
    },
    requires: {
      resourceIntents: intents,
    },
  };
  
  return { capability, intents };
}

function extractQueue(cls: ClassDeclaration, filePath: string) {
  const queueDec = cls.getDecorator('Queue');
  if (!queueDec) return null;
  
  const args = queueDec.getArguments();
  if (args.length === 0) return null;
  
  const nameArg = args[0];
  const configArg = args[1];
  
  const queueName = nameArg.getKind() === 200 ?
    nameArg.getText().slice(1, -1) : 'unknown';
  
  const config = configArg ? parseObjectLiteral(configArg) : {};
  const intents = translateResourceAccessToIntents(config.resourceAccess);
  
  const capability: CapabilityDescriptor = {
    id: `${queueName}:queue:${cls.getName()}`,
    kind: 'queue',
    sourceFile: filePath,
    exportName: cls.getName() || 'UnknownQueue',
    queue: { name: queueName },
    requires: {
      resourceIntents: intents,
    },
  };
  
  return { capability, intents };
}

function extractTask(cls: ClassDeclaration, filePath: string) {
  const taskDec = cls.getDecorator('Task');
  if (!taskDec) return null;
  
  const args = taskDec.getArguments();
  if (args.length === 0) return null;
  
  const nameArg = args[0];
  const configArg = args[1];
  
  const taskName = nameArg.getKind() === 200 ?
    nameArg.getText().slice(1, -1) : 'unknown';
  
  const config = configArg ? parseObjectLiteral(configArg) : {};
  const intents = translateResourceAccessToIntents(config.resourceAccess);
  const schedule = config.schedule || 'rate(1 hour)';
  
  const capability: CapabilityDescriptor = {
    id: `${taskName}:task:${cls.getName()}`,
    kind: 'task',
    sourceFile: filePath,
    exportName: cls.getName() || 'UnknownTask',
    schedule: { rate: schedule },
    requires: {
      resourceIntents: intents,
    },
  };
  
  return { capability, intents };
}

function extractRoutes(cls: ClassDeclaration, controllerAuthorizer?: any): CapabilityRoute[] {
  const routes: CapabilityRoute[] = [];
  
  for (const method of cls.getMethods()) {
    const routeDec = method.getDecorators().find(d => 
      ['Get', 'Post', 'Put', 'Delete', 'Patch'].includes(d.getName())
    );
    
    if (!routeDec) continue;
    
    const httpMethod = routeDec.getName().toUpperCase();
    const args = routeDec.getArguments();
    const pathArg = args[0];
    const optionsArg = args[1];
    
    let path = '/';
    if (pathArg && pathArg.getKind() === SyntaxKind.StringLiteral) {
      const pathText = pathArg.getText().slice(1, -1); // Remove quotes
      path = pathText || '/'; // Empty string becomes '/'
    }
    
    const options = optionsArg ? parseObjectLiteral(optionsArg) : {};
    
    const route: CapabilityRoute = {
      method: httpMethod,
      path: path || '/',
    };
    
    // Apply route-level authorizer if present, otherwise use controller-level
    if (options.authorizer) {
      route.authorizer = parseAuthorizer(options.authorizer);
    } else if (controllerAuthorizer) {
      route.authorizer = parseAuthorizer(controllerAuthorizer);
    }
    
    if (options.target) {
      route.target = options.target as 'function' | 'queue' | 'topic';
      if (route.target !== 'function' && path) {
        route.targetName = path.replace('/', '');
      }
    }
    
    routes.push(route);
  }
  
  return routes;
}

function parseAuthorizer(authValue: any): CapabilityRoute['authorizer'] {
  if (typeof authValue === 'string') {
    return authValue as AuthorizerType;
  }
  
  if (typeof authValue === 'object' && authValue.type) {
    return {
      type: authValue.type as AuthorizerType,
      name: authValue.name,
      groups: authValue.groups || [],
      requireRouteInGroupConfig: authValue.requireRouteInGroupConfig || false,
    };
  }
  
  return 'NONE';
}

function parseObjectLiteral(node: Node): any {
  // Try to get the text and parse it as JSON-like object
  const text = node.getText();
  
  // Handle simple cases first
  if (text === '{}') return {};
  
  try {
    // For simple object literals, try to extract key-value pairs
    const result: any = {};
    
    // Look for authorizer property
    const authorizerMatch = text.match(/authorizer\s*:\s*\{([^}]+)\}/);
    if (authorizerMatch) {
      const authContent = authorizerMatch[1];
      const typeMatch = authContent.match(/type\s*:\s*['"`]([^'"`]+)['"`]/);
      const groupsMatch = authContent.match(/groups\s*:\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/);
      
      result.authorizer = {
        type: typeMatch ? typeMatch[1] : 'AWS_IAM',
        groups: groupsMatch ? [groupsMatch[1]] : []
      };
    }
    
    // Look for resourceAccess property
    const resourceAccessMatch = text.match(/resourceAccess\s*:\s*\{([^}]+)\}/);
    if (resourceAccessMatch) {
      const resourceContent = resourceAccessMatch[1];
      result.resourceAccess = {};
      
      const tablesMatch = resourceContent.match(/tables\s*:\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/);
      if (tablesMatch) {
        result.resourceAccess.tables = [tablesMatch[1]];
      }
      
      const bucketsMatch = resourceContent.match(/buckets\s*:\s*\[\s*([^[\]]+)\s*\]/);
      if (bucketsMatch) {
        // Handle variable references like FILES_BUCKET_NAME
        const bucketContent = bucketsMatch[1].trim();
        if (bucketContent.includes('FILES_BUCKET_NAME')) {
          result.resourceAccess.buckets = ['files-bucket'];
        } else {
          const bucketNameMatch = bucketContent.match(/['"`]([^'"`]+)['"`]/);
          if (bucketNameMatch) {
            result.resourceAccess.buckets = [bucketNameMatch[1]];
          }
        }
      }
    }
    
    return result;
  } catch (e) {
    // If parsing fails, return empty object
    return {};
  }
}
