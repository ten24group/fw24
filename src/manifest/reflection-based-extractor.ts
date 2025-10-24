import 'reflect-metadata';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join, resolve, relative, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { glob } from 'glob';
import { METADATA_KEYS } from './metadata-keys';
import { translateResourceAccessToIntents } from './translate';
import type { 
  Manifest, 
  ModuleDescriptor, 
  EntityDescriptor, 
  CapabilityDescriptor, 
  ResourceIntent,
  AuthorizerType,
  CapabilityRoute
} from './types';

const execAsync = promisify(exec);

export interface ReflectionExtractionOptions {
  rootDir: string;
  cacheDir?: string;
  skipCache?: boolean;
  parallel?: boolean;
}

export interface ReflectionExtractionResult {
  modules: ModuleDescriptor[];
  entities: EntityDescriptor[];
  capabilities: CapabilityDescriptor[];
  resourceIntents: ResourceIntent[];
}

/**
 * Production-grade reflection-based manifest extractor
 * 
 * This extractor:
 * 1. Compiles TypeScript to JavaScript in a temp directory
 * 2. Imports compiled JavaScript modules to trigger decorators
 * 3. Uses reflect-metadata to extract stored metadata
 * 4. Caches results based on source file hashes
 */
export class ReflectionBasedExtractor {
  private readonly options: Required<ReflectionExtractionOptions>;
  private readonly cacheFile: string;
  private cache: Map<string, { hash: string; result: any }> = new Map();

  constructor(options: ReflectionExtractionOptions) {
    this.options = {
      cacheDir: join(options.rootDir, '.fw24', 'cache'),
      skipCache: false,
      parallel: true,
      ...options
    };
    
    this.cacheFile = join(this.options.cacheDir, 'reflection-cache.json');
    this.loadCache();
  }

  /**
   * Extract manifest data using reflection
   */
  async extract(): Promise<ReflectionExtractionResult> {
    console.log('[ReflectionExtractor] Starting production reflection-based extraction...');
    
    // 1. Create temp compilation directory
    const tempDir = join(this.options.cacheDir, 'compiled');
    await this.ensureDirectory(tempDir);

    // 2. Compile TypeScript to JavaScript
    console.log('[ReflectionExtractor] Compiling TypeScript...');
    await this.compileTypeScript(tempDir);

    // 3. Find all compiled files
    const compiledFiles = await this.findCompiledFiles(tempDir);
    
    // 4. Extract metadata from compiled files
    console.log(`[ReflectionExtractor] Extracting metadata from ${compiledFiles.length} files...`);
    const result = await this.extractFromCompiledFiles(compiledFiles, tempDir);

    // Extract entity metadata from global registry
    this.extractEntityMetadata(result);

    console.log('[ReflectionExtractor] Extraction completed successfully');
    this.saveCache();
    
    return result;
  }

  /**
   * Compile TypeScript to JavaScript
   */
  private async compileTypeScript(outDir: string): Promise<void> {
    try {
      const tsconfigPath = join(this.options.rootDir, 'tsconfig.json');
      const command = `npx tsc --project ${tsconfigPath} --outDir ${outDir} --module commonjs --target es2020 --moduleResolution node --esModuleInterop true --allowSyntheticDefaultImports true --experimentalDecorators true --emitDecoratorMetadata true --skipLibCheck true --noEmitOnError false --noImplicitAny false --strict false`;
      
      const { stderr } = await execAsync(command, { 
        cwd: this.options.rootDir,
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });
      
      if (stderr && !stderr.includes('warning')) {
        console.warn('[ReflectionExtractor] TypeScript compilation warnings:', stderr);
      }
    } catch (error: any) {
      console.warn('[ReflectionExtractor] TypeScript compilation had errors, but continuing with partial compilation:', error.message);
      // Don't throw - continue with whatever was compiled
    }
  }

  /**
   * Find all compiled JavaScript files
   */
  private async findCompiledFiles(tempDir: string): Promise<string[]> {
    const patterns = [
      join(tempDir, 'src/controllers/**/*.js'),
      join(tempDir, 'src/services/**/*.js'),
      join(tempDir, 'src/entities/**/*.js'),
      join(tempDir, 'src/queues/**/*.js'),
      join(tempDir, 'src/tasks/**/*.js'),
      join(tempDir, 'src/di.js'),
      join(tempDir, 'src/**/di.js')
    ];

    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern);
      files.push(...matches);
    }

    return [...new Set(files)]; // Remove duplicates
  }

  /**
   * Extract metadata from compiled JavaScript files
   */
  private async extractFromCompiledFiles(
    files: string[], 
    tempDir: string
  ): Promise<ReflectionExtractionResult> {
    const result: ReflectionExtractionResult = {
      modules: [],
      entities: [],
      capabilities: [],
      resourceIntents: []
    };

    for (const filePath of files) {
      try {
        const fileHash = this.calculateFileHash(filePath);
        const relativePath = relative(tempDir, filePath);

        // Check cache first
        if (!this.options.skipCache && this.cache.has(relativePath)) {
          const cached = this.cache.get(relativePath)!;
          if (cached.hash === fileHash) {
            console.log(`[ReflectionExtractor] Using cached result for ${relativePath}`);
            this.mergeResults(result, cached.result);
            continue;
          }
        }

        // Extract from file
        const fileResult = await this.extractFromFile(filePath, tempDir);
        
        // Cache the result
        this.cache.set(relativePath, { hash: fileHash, result: fileResult });
        
        // Merge with overall result
        this.mergeResults(result, fileResult);
        
      } catch (error: any) {
        console.warn(`[ReflectionExtractor] Failed to extract from ${filePath}:`, error.message);
        // Continue with other files
      }
    }

    return result;
  }

  /**
   * Extract metadata from a single compiled file
   */
  private async extractFromFile(
    filePath: string, 
    tempDir: string
  ): Promise<ReflectionExtractionResult> {
    const result: ReflectionExtractionResult = {
      modules: [],
      entities: [],
      capabilities: [],
      resourceIntents: []
    };

    try {
      // Clear require cache to ensure fresh import
      delete require.cache[require.resolve(filePath)];
      
      // Import the compiled module
      const module = require(filePath);
      
      // Extract metadata from all exported classes
      for (const [exportName, exportedItem] of Object.entries(module)) {
        if (typeof exportedItem === 'function' && exportedItem.prototype) {
          const classConstructor = exportedItem as Function & { prototype: any };
          
          // Extract controller metadata
          const controllerMeta = Reflect.getMetadata(METADATA_KEYS.CONTROLLER, classConstructor);
          if (controllerMeta) {
            const capability = this.extractControllerCapability(
              classConstructor, 
              controllerMeta, 
              exportName,
              filePath,
              tempDir
            );
            result.capabilities.push(capability);
          }

          // Extract service metadata
          const serviceMeta = Reflect.getMetadata(METADATA_KEYS.SERVICE, classConstructor);
          if (serviceMeta) {
            // Services will be part of module providers
            console.log(`[ReflectionExtractor] Found service: ${exportName}`);
          }

          // Extract queue metadata
          const queueMeta = Reflect.getMetadata(METADATA_KEYS.QUEUE, classConstructor);
          if (queueMeta) {
            const capability = this.extractQueueCapability(
              classConstructor,
              queueMeta,
              exportName,
              filePath,
              tempDir
            );
            result.capabilities.push(capability);
          }

          // Extract task metadata
          const taskMeta = Reflect.getMetadata(METADATA_KEYS.TASK, classConstructor);
          if (taskMeta) {
            const capability = this.extractTaskCapability(
              classConstructor,
              taskMeta,
              exportName,
              filePath,
              tempDir
            );
            result.capabilities.push(capability);
          }
        }
      }

    } catch (error: any) {
      console.warn(`[ReflectionExtractor] Error processing ${filePath}:`, error.message);
    }

    return result;
  }

  /**
   * Extract controller capability with routes
   */
  private extractControllerCapability(
    classConstructor: any,
    controllerMeta: any,
    exportName: string,
    filePath: string,
    tempDir: string
  ): CapabilityDescriptor {
    const routes = this.extractRoutesFromClass(classConstructor);
    const sourceFile = this.getRelativeSourcePath(filePath, tempDir);
    const resourceIntents = this.extractResourceIntents(controllerMeta.config);

    return {
      id: `${controllerMeta.name.toLowerCase()}:controller:${exportName}`,
      kind: 'controller',
      sourceFile,
      exportName,
      routing: {
        basePath: controllerMeta.basePath,
        routes
      },
      requires: {
        resourceIntents
      },
      tags: []
    };
  }

  /**
   * Extract routes from controller class methods using reflection
   */
  private extractRoutesFromClass(classConstructor: any) {
    const routes = [];
    const prototype = classConstructor.prototype;
    
    // Get all method names
    const methodNames = Object.getOwnPropertyNames(prototype)
      .filter(name => name !== 'constructor' && typeof prototype[name] === 'function');

    console.log(`[ReflectionExtractor] Checking ${methodNames.length} methods for route metadata`);

    for (const methodName of methodNames) {
      const routeMeta = Reflect.getMetadata(METADATA_KEYS.ROUTE, prototype, methodName);
      if (routeMeta) {
        console.log(`[ReflectionExtractor] Found route metadata for ${methodName}:`, routeMeta);
        
        // Convert authorizer to proper format
        let authorizer: CapabilityRoute['authorizer'] = routeMeta.options.authorizer || 'AWS_IAM';
        if (typeof authorizer === 'object') {
          // Handle AuthorizerTypeMetadata objects
          authorizer = {
            type: authorizer.type || 'AWS_IAM',
            name: authorizer.name,
            groups: authorizer.groups,
            requireRouteInGroupConfig: authorizer.requireRouteInGroupConfig
          };
        }

        routes.push({
          method: routeMeta.method,
          path: routeMeta.path,
          authorizer,
          target: routeMeta.options.target || 'function',
          targetName: routeMeta.options.target && routeMeta.options.target !== 'function' 
            ? routeMeta.path.replace(/^\//, '') 
            : undefined,
          validations: routeMeta.options.validations,
          parameters: routeMeta.parameters
        });
      }
    }

    console.log(`[ReflectionExtractor] Extracted ${routes.length} routes from class`);
    return routes;
  }

  /**
   * Extract queue capability
   */
  private extractQueueCapability(
    _classConstructor: any,
    queueMeta: any,
    exportName: string,
    filePath: string,
    tempDir: string
  ): CapabilityDescriptor {
    const sourceFile = this.getRelativeSourcePath(filePath, tempDir);
    const resourceIntents = this.extractResourceIntents(queueMeta.config);

    return {
      id: `${queueMeta.name.toLowerCase()}:queue:${exportName}`,
      kind: 'queue',
      sourceFile,
      exportName,
      queue: { name: queueMeta.name },
      requires: {
        resourceIntents
      },
      tags: []
    };
  }

  /**
   * Extract task capability
   */
  private extractTaskCapability(
    _classConstructor: any,
    taskMeta: any,
    exportName: string,
    filePath: string,
    tempDir: string
  ): CapabilityDescriptor {
    const sourceFile = this.getRelativeSourcePath(filePath, tempDir);
    const resourceIntents = this.extractResourceIntents(taskMeta.config);

    return {
      id: `${taskMeta.name.toLowerCase()}:task:${exportName}`,
      kind: 'task',
      sourceFile,
      exportName,
      schedule: { rate: taskMeta.config.schedule },
      requires: {
        resourceIntents
      },
      tags: []
    };
  }

  /**
   * Extract resource intents from config using proper translation
   */
  private extractResourceIntents(config: any): ResourceIntent[] {
    if (!config.resourceAccess) {
      return [];
    }

    try {
      return translateResourceAccessToIntents(config.resourceAccess);
    } catch (error) {
      console.warn('[ReflectionExtractor] Failed to translate resource access:', error);
      return [];
    }
  }

  /**
   * Extract entity metadata from global registry
   */
  private extractEntityMetadata(result: ReflectionExtractionResult): void {
    const globalEntityRegistry = (global as any).__fw24EntityRegistry;
    if (!globalEntityRegistry) {
      console.log('[ReflectionExtractor] No global entity registry found');
      return;
    }

    console.log(`[ReflectionExtractor] Found ${globalEntityRegistry.size} entities in global registry`);
    
    for (const [entityName, metadata] of globalEntityRegistry.entries()) {
      const entityDescriptor: EntityDescriptor = {
        name: entityName,
        schemaProviderToken: metadata.schemaProviderToken,
        tags: metadata.tags || []
      };
      
      result.entities.push(entityDescriptor);
      console.log(`[ReflectionExtractor] Added entity: ${entityName}`);
    }
  }

  /**
   * Utility functions
   */
  private getRelativeSourcePath(compiledPath: string, tempDir: string): string {
    const relativePath = relative(tempDir, compiledPath);
    return relativePath.replace(/\.js$/, '.ts'); // Convert back to .ts extension
  }

  private mergeResults(target: ReflectionExtractionResult, source: ReflectionExtractionResult): void {
    target.modules.push(...source.modules);
    target.entities.push(...source.entities);
    target.capabilities.push(...source.capabilities);
    target.resourceIntents.push(...source.resourceIntents);
  }

  private calculateFileHash(filePath: string): string {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  private async ensureDirectory(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private loadCache(): void {
    try {
      if (existsSync(this.cacheFile)) {
        const cacheData = JSON.parse(readFileSync(this.cacheFile, 'utf-8'));
        this.cache = new Map(Object.entries(cacheData));
      }
    } catch (error) {
      console.warn('[ReflectionExtractor] Failed to load cache, starting fresh');
      this.cache = new Map();
    }
  }

  private saveCache(): void {
    try {
      this.ensureDirectory(dirname(this.cacheFile));
      const cacheData = Object.fromEntries(this.cache.entries());
      writeFileSync(this.cacheFile, JSON.stringify(cacheData, null, 2));
    } catch (error) {
      console.warn('[ReflectionExtractor] Failed to save cache:', error);
    }
  }
}
