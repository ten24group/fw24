"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReflectionBasedExtractor = void 0;
require("reflect-metadata");
const child_process_1 = require("child_process");
const util_1 = require("util");
const path_1 = require("path");
const fs_1 = require("fs");
const crypto_1 = require("crypto");
const glob_1 = require("glob");
const metadata_keys_1 = require("./metadata-keys");
const translate_1 = require("./translate");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * Production-grade reflection-based manifest extractor
 *
 * This extractor:
 * 1. Compiles TypeScript to JavaScript in a temp directory
 * 2. Imports compiled JavaScript modules to trigger decorators
 * 3. Uses reflect-metadata to extract stored metadata
 * 4. Caches results based on source file hashes
 */
class ReflectionBasedExtractor {
    options;
    cacheFile;
    cache = new Map();
    constructor(options) {
        this.options = {
            cacheDir: (0, path_1.join)(options.rootDir, '.fw24', 'cache'),
            skipCache: false,
            parallel: true,
            ...options
        };
        this.cacheFile = (0, path_1.join)(this.options.cacheDir, 'reflection-cache.json');
        this.loadCache();
    }
    /**
     * Extract manifest data using reflection
     */
    async extract() {
        console.log('[ReflectionExtractor] Starting production reflection-based extraction...');
        // 1. Create temp compilation directory
        const tempDir = (0, path_1.join)(this.options.cacheDir, 'compiled');
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
    async compileTypeScript(outDir) {
        try {
            const tsconfigPath = (0, path_1.join)(this.options.rootDir, 'tsconfig.json');
            const command = `npx tsc --project ${tsconfigPath} --outDir ${outDir} --module commonjs --target es2020 --moduleResolution node --esModuleInterop true --allowSyntheticDefaultImports true --experimentalDecorators true --emitDecoratorMetadata true --skipLibCheck true --noEmitOnError false --noImplicitAny false --strict false`;
            const { stderr } = await execAsync(command, {
                cwd: this.options.rootDir,
                maxBuffer: 1024 * 1024 * 10 // 10MB buffer
            });
            if (stderr && !stderr.includes('warning')) {
                console.warn('[ReflectionExtractor] TypeScript compilation warnings:', stderr);
            }
        }
        catch (error) {
            console.warn('[ReflectionExtractor] TypeScript compilation had errors, but continuing with partial compilation:', error.message);
            // Don't throw - continue with whatever was compiled
        }
    }
    /**
     * Find all compiled JavaScript files
     */
    async findCompiledFiles(tempDir) {
        const patterns = [
            (0, path_1.join)(tempDir, 'src/controllers/**/*.js'),
            (0, path_1.join)(tempDir, 'src/services/**/*.js'),
            (0, path_1.join)(tempDir, 'src/entities/**/*.js'),
            (0, path_1.join)(tempDir, 'src/queues/**/*.js'),
            (0, path_1.join)(tempDir, 'src/tasks/**/*.js'),
            (0, path_1.join)(tempDir, 'src/di.js'),
            (0, path_1.join)(tempDir, 'src/**/di.js')
        ];
        const files = [];
        for (const pattern of patterns) {
            const matches = await (0, glob_1.glob)(pattern);
            files.push(...matches);
        }
        return [...new Set(files)]; // Remove duplicates
    }
    /**
     * Extract metadata from compiled JavaScript files
     */
    async extractFromCompiledFiles(files, tempDir) {
        const result = {
            modules: [],
            entities: [],
            capabilities: [],
            resourceIntents: []
        };
        for (const filePath of files) {
            try {
                const fileHash = this.calculateFileHash(filePath);
                const relativePath = (0, path_1.relative)(tempDir, filePath);
                // Check cache first
                if (!this.options.skipCache && this.cache.has(relativePath)) {
                    const cached = this.cache.get(relativePath);
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
            }
            catch (error) {
                console.warn(`[ReflectionExtractor] Failed to extract from ${filePath}:`, error.message);
                // Continue with other files
            }
        }
        return result;
    }
    /**
     * Extract metadata from a single compiled file
     */
    async extractFromFile(filePath, tempDir) {
        const result = {
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
                    const classConstructor = exportedItem;
                    // Extract controller metadata
                    const controllerMeta = Reflect.getMetadata(metadata_keys_1.METADATA_KEYS.CONTROLLER, classConstructor);
                    if (controllerMeta) {
                        const capability = this.extractControllerCapability(classConstructor, controllerMeta, exportName, filePath, tempDir);
                        result.capabilities.push(capability);
                    }
                    // Extract service metadata
                    const serviceMeta = Reflect.getMetadata(metadata_keys_1.METADATA_KEYS.SERVICE, classConstructor);
                    if (serviceMeta) {
                        // Services will be part of module providers
                        console.log(`[ReflectionExtractor] Found service: ${exportName}`);
                    }
                    // Extract queue metadata
                    const queueMeta = Reflect.getMetadata(metadata_keys_1.METADATA_KEYS.QUEUE, classConstructor);
                    if (queueMeta) {
                        const capability = this.extractQueueCapability(classConstructor, queueMeta, exportName, filePath, tempDir);
                        result.capabilities.push(capability);
                    }
                    // Extract task metadata
                    const taskMeta = Reflect.getMetadata(metadata_keys_1.METADATA_KEYS.TASK, classConstructor);
                    if (taskMeta) {
                        const capability = this.extractTaskCapability(classConstructor, taskMeta, exportName, filePath, tempDir);
                        result.capabilities.push(capability);
                    }
                }
            }
        }
        catch (error) {
            console.warn(`[ReflectionExtractor] Error processing ${filePath}:`, error.message);
        }
        return result;
    }
    /**
     * Extract controller capability with routes
     */
    extractControllerCapability(classConstructor, controllerMeta, exportName, filePath, tempDir) {
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
    extractRoutesFromClass(classConstructor) {
        const routes = [];
        const prototype = classConstructor.prototype;
        // Get all method names
        const methodNames = Object.getOwnPropertyNames(prototype)
            .filter(name => name !== 'constructor' && typeof prototype[name] === 'function');
        console.log(`[ReflectionExtractor] Checking ${methodNames.length} methods for route metadata`);
        for (const methodName of methodNames) {
            const routeMeta = Reflect.getMetadata(metadata_keys_1.METADATA_KEYS.ROUTE, prototype, methodName);
            if (routeMeta) {
                console.log(`[ReflectionExtractor] Found route metadata for ${methodName}:`, routeMeta);
                // Convert authorizer to proper format
                let authorizer = routeMeta.options.authorizer || 'AWS_IAM';
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
    extractQueueCapability(_classConstructor, queueMeta, exportName, filePath, tempDir) {
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
    extractTaskCapability(_classConstructor, taskMeta, exportName, filePath, tempDir) {
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
    extractResourceIntents(config) {
        if (!config.resourceAccess) {
            return [];
        }
        try {
            return (0, translate_1.translateResourceAccessToIntents)(config.resourceAccess);
        }
        catch (error) {
            console.warn('[ReflectionExtractor] Failed to translate resource access:', error);
            return [];
        }
    }
    /**
     * Extract entity metadata from global registry
     */
    extractEntityMetadata(result) {
        const globalEntityRegistry = global.__fw24EntityRegistry;
        if (!globalEntityRegistry) {
            console.log('[ReflectionExtractor] No global entity registry found');
            return;
        }
        console.log(`[ReflectionExtractor] Found ${globalEntityRegistry.size} entities in global registry`);
        for (const [entityName, metadata] of globalEntityRegistry.entries()) {
            const entityDescriptor = {
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
    getRelativeSourcePath(compiledPath, tempDir) {
        const relativePath = (0, path_1.relative)(tempDir, compiledPath);
        return relativePath.replace(/\.js$/, '.ts'); // Convert back to .ts extension
    }
    mergeResults(target, source) {
        target.modules.push(...source.modules);
        target.entities.push(...source.entities);
        target.capabilities.push(...source.capabilities);
        target.resourceIntents.push(...source.resourceIntents);
    }
    calculateFileHash(filePath) {
        const content = (0, fs_1.readFileSync)(filePath);
        return (0, crypto_1.createHash)('sha256').update(content).digest('hex');
    }
    async ensureDirectory(dir) {
        if (!(0, fs_1.existsSync)(dir)) {
            (0, fs_1.mkdirSync)(dir, { recursive: true });
        }
    }
    loadCache() {
        try {
            if ((0, fs_1.existsSync)(this.cacheFile)) {
                const cacheData = JSON.parse((0, fs_1.readFileSync)(this.cacheFile, 'utf-8'));
                this.cache = new Map(Object.entries(cacheData));
            }
        }
        catch (error) {
            console.warn('[ReflectionExtractor] Failed to load cache, starting fresh');
            this.cache = new Map();
        }
    }
    saveCache() {
        try {
            this.ensureDirectory((0, path_1.dirname)(this.cacheFile));
            const cacheData = Object.fromEntries(this.cache.entries());
            (0, fs_1.writeFileSync)(this.cacheFile, JSON.stringify(cacheData, null, 2));
        }
        catch (error) {
            console.warn('[ReflectionExtractor] Failed to save cache:', error);
        }
    }
}
exports.ReflectionBasedExtractor = ReflectionBasedExtractor;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVmbGVjdGlvbi1iYXNlZC1leHRyYWN0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbWFuaWZlc3QvcmVmbGVjdGlvbi1iYXNlZC1leHRyYWN0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNEJBQTBCO0FBQzFCLGlEQUFxQztBQUNyQywrQkFBaUM7QUFDakMsK0JBQXdEO0FBQ3hELDJCQUF3RTtBQUN4RSxtQ0FBb0M7QUFDcEMsK0JBQTRCO0FBQzVCLG1EQUFnRDtBQUNoRCwyQ0FBK0Q7QUFXL0QsTUFBTSxTQUFTLEdBQUcsSUFBQSxnQkFBUyxFQUFDLG9CQUFJLENBQUMsQ0FBQztBQWdCbEM7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFhLHdCQUF3QjtJQUNsQixPQUFPLENBQXdDO0lBQy9DLFNBQVMsQ0FBUztJQUMzQixLQUFLLEdBQStDLElBQUksR0FBRyxFQUFFLENBQUM7SUFFdEUsWUFBWSxPQUFvQztRQUM5QyxJQUFJLENBQUMsT0FBTyxHQUFHO1lBQ2IsUUFBUSxFQUFFLElBQUEsV0FBSSxFQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBQztZQUNqRCxTQUFTLEVBQUUsS0FBSztZQUNoQixRQUFRLEVBQUUsSUFBSTtZQUNkLEdBQUcsT0FBTztTQUNYLENBQUM7UUFFRixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUEsV0FBSSxFQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLHVCQUF1QixDQUFDLENBQUM7UUFDdEUsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO0lBQ25CLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsT0FBTyxDQUFDLEdBQUcsQ0FBQywwRUFBMEUsQ0FBQyxDQUFDO1FBRXhGLHVDQUF1QztRQUN2QyxNQUFNLE9BQU8sR0FBRyxJQUFBLFdBQUksRUFBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxVQUFV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SUFBSSxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNwRSxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxJQUFJLENBQUMsNkNBQTZDLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDckUsQ0FBQztJQUNILENBQUM7Q0FDRjtBQXJiRCw0REFxYkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgJ3JlZmxlY3QtbWV0YWRhdGEnO1xuaW1wb3J0IHsgZXhlYyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgcHJvbWlzaWZ5IH0gZnJvbSAndXRpbCc7XG5pbXBvcnQgeyBqb2luLCByZXNvbHZlLCByZWxhdGl2ZSwgZGlybmFtZSB9IGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgZXhpc3RzU3luYywgbWtkaXJTeW5jLCByZWFkRmlsZVN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tICdmcyc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IGdsb2IgfSBmcm9tICdnbG9iJztcbmltcG9ydCB7IE1FVEFEQVRBX0tFWVMgfSBmcm9tICcuL21ldGFkYXRhLWtleXMnO1xuaW1wb3J0IHsgdHJhbnNsYXRlUmVzb3VyY2VBY2Nlc3NUb0ludGVudHMgfSBmcm9tICcuL3RyYW5zbGF0ZSc7XG5pbXBvcnQgdHlwZSB7IFxuICBNYW5pZmVzdCwgXG4gIE1vZHVsZURlc2NyaXB0b3IsIFxuICBFbnRpdHlEZXNjcmlwdG9yLCBcbiAgQ2FwYWJpbGl0eURlc2NyaXB0b3IsIFxuICBSZXNvdXJjZUludGVudCxcbiAgQXV0aG9yaXplclR5cGUsXG4gIENhcGFiaWxpdHlSb3V0ZVxufSBmcm9tICcuL3R5cGVzJztcblxuY29uc3QgZXhlY0FzeW5jID0gcHJvbWlzaWZ5KGV4ZWMpO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJlZmxlY3Rpb25FeHRyYWN0aW9uT3B0aW9ucyB7XG4gIHJvb3REaXI6IHN0cmluZztcbiAgY2FjaGVEaXI/OiBzdHJpbmc7XG4gIHNraXBDYWNoZT86IGJvb2xlYW47XG4gIHBhcmFsbGVsPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZWZsZWN0aW9uRXh0cmFjdGlvblJlc3VsdCB7XG4gIG1vZHVsZXM6IE1vZHVsZURlc2NyaXB0b3JbXTtcbiAgZW50aXRpZXM6IEVudGl0eURlc2NyaXB0b3JbXTtcbiAgY2FwYWJpbGl0aWVzOiBDYXBhYmlsaXR5RGVzY3JpcHRvcltdO1xuICByZXNvdXJjZUludGVudHM6IFJlc291cmNlSW50ZW50W107XG59XG5cbi8qKlxuICogUHJvZHVjdGlvbi1ncmFkZSByZWZsZWN0aW9uLWJhc2VkIG1hbmlmZXN0IGV4dHJhY3RvclxuICogXG4gKiBUaGlzIGV4dHJhY3RvcjpcbiAqIDEuIENvbXBpbGVzIFR5cGVTY3JpcHQgdG8gSmF2YVNjcmlwdCBpbiBhIHRlbXAgZGlyZWN0b3J5XG4gKiAyLiBJbXBvcnRzIGNvbXBpbGVkIEphdmFTY3JpcHQgbW9kdWxlcyB0byB0cmlnZ2VyIGRlY29yYXRvcnNcbiAqIDMuIFVzZXMgcmVmbGVjdC1tZXRhZGF0YSB0byBleHRyYWN0IHN0b3JlZCBtZXRhZGF0YVxuICogNC4gQ2FjaGVzIHJlc3VsdHMgYmFzZWQgb24gc291cmNlIGZpbGUgaGFzaGVzXG4gKi9cbmV4cG9ydCBjbGFzcyBSZWZsZWN0aW9uQmFzZWRFeHRyYWN0b3Ige1xuICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IFJlcXVpcmVkPFJlZmxlY3Rpb25FeHRyYWN0aW9uT3B0aW9ucz47XG4gIHByaXZhdGUgcmVhZG9ubHkgY2FjaGVGaWxlOiBzdHJpbmc7XG4gIHByaXZhdGUgY2FjaGU6IE1hcDxzdHJpbmcsIHsgaGFzaDogc3RyaW5nOyByZXN1bHQ6IGFueSB9PiA9IG5ldyBNYXAoKTtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBSZWZsZWN0aW9uRXh0cmFjdGlvbk9wdGlvbnMpIHtcbiAgICB0aGlzLm9wdGlvbnMgPSB7XG4gICAgICBjYWNoZURpcjogam9pbihvcHRpb25zLnJvb3REaXIsICcuZncyNCcsICdjYWNoZScpLFxuICAgICAgc2tpcENhY2hlOiBmYWxzZSxcbiAgICAgIHBhcmFsbGVsOiB0cnVlLFxuICAgICAgLi4ub3B0aW9uc1xuICAgIH07XG4gICAgXG4gICAgdGhpcy5jYWNoZUZpbGUgPSBqb2luKHRoaXMub3B0aW9ucy5jYWNoZURpciwgJ3JlZmxlY3Rpb24tY2FjaGUuanNvbicpO1xuICAgIHRoaXMubG9hZENhY2hlKCk7XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBtYW5pZmVzdCBkYXRhIHVzaW5nIHJlZmxlY3Rpb25cbiAgICovXG4gIGFzeW5jIGV4dHJhY3QoKTogUHJvbWlzZTxSZWZsZWN0aW9uRXh0cmFjdGlvblJlc3VsdD4ge1xuICAgIGNvbnNvbGUubG9nKCdbUmVmbGVjdGlvbkV4dHJhY3Rvcl0gU3RhcnRpbmcgcHJvZHVjdGlvbiByZWZsZWN0aW9uLWJhc2VkIGV4dHJhY3Rpb24uLi4nKTtcbiAgICBcbiAgICAvLyAxLiBDcmVhdGUgdGVtcCBjb21waWxhdGlvbiBkaXJlY3RvcnlcbiAgICBjb25zdCB0ZW1wRGlyID0gam9pbih0aGlzLm9wdGlvbnMuY2FjaGVEaXIsICdjb21waWxlZCcpO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlRGlyZWN0b3J5KHRlbXBEaXIpO1xuXG4gICAgLy8gMi4gQ29tcGlsZSBUeXBlU2NyaXB0IHRvIEphdmFTY3JpcHRcbiAgICBjb25zb2xlLmxvZygnW1JlZmxlY3Rpb25FeHRyYWN0b3JdIENvbXBpbGluZyBUeXBlU2NyaXB0Li4uJyk7XG4gICAgYXdhaXQgdGhpcy5jb21waWxlVHlwZVNjcmlwdCh0ZW1wRGlyKTtcblxuICAgIC8vIDMuIEZpbmQgYWxsIGNvbXBpbGVkIGZpbGVzXG4gICAgY29uc3QgY29tcGlsZWRGaWxlcyA9IGF3YWl0IHRoaXMuZmluZENvbXBpbGVkRmlsZXModGVtcERpcik7XG4gICAgXG4gICAgLy8gNC4gRXh0cmFjdCBtZXRhZGF0YSBmcm9tIGNvbXBpbGVkIGZpbGVzXG4gICAgY29uc29sZS5sb2coYFtSZWZsZWN0aW9uRXh0cmFjdG9yXSBFeHRyYWN0aW5nIG1ldGFkYXRhIGZyb20gJHtjb21waWxlZEZpbGVzLmxlbmd0aH0gZmlsZXMuLi5gKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmV4dHJhY3RGcm9tQ29tcGlsZWRGaWxlcyhjb21waWxlZEZpbGVzLCB0ZW1wRGlyKTtcblxuICAgIC8vIEV4dHJhY3QgZW50aXR5IG1ldGFkYXRhIGZyb20gZ2xvYmFsIHJlZ2lzdHJ5XG4gICAgdGhpcy5leHRyYWN0RW50aXR5TWV0YWRhdGEocmVzdWx0KTtcblxuICAgIGNvbnNvbGUubG9nKCdbUmVmbGVjdGlvbkV4dHJhY3Rvcl0gRXh0cmFjdGlvbiBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5Jyk7XG4gICAgdGhpcy5zYXZlQ2FjaGUoKTtcbiAgICBcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLyoqXG4gICAqIENvbXBpbGUgVHlwZVNjcmlwdCB0byBKYXZhU2NyaXB0XG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGNvbXBpbGVUeXBlU2NyaXB0KG91dERpcjogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHRzY29uZmlnUGF0aCA9IGpvaW4odGhpcy5vcHRpb25zLnJvb3REaXIsICd0c2NvbmZpZy5qc29uJyk7XG4gICAgICBjb25zdCBjb21tYW5kID0gYG5weCB0c2MgLS1wcm9qZWN0ICR7dHNjb25maWdQYXRofSAtLW91dERpciAke291dERpcn0gLS1tb2R1bGUgY29tbW9uanMgLS10YXJnZXQgZXMyMDIwIC0tbW9kdWxlUmVzb2x1dGlvbiBub2RlIC0tZXNNb2R1bGVJbnRlcm9wIHRydWUgLS1hbGxvd1N5bnRoZXRpY0RlZmF1bHRJbXBvcnRzIHRydWUgLS1leHBlcmltZW50YWxEZWNvcmF0b3JzIHRydWUgLS1lbWl0RGVjb3JhdG9yTWV0YWRhdGEgdHJ1ZSAtLXNraXBMaWJDaGVjayB0cnVlIC0tbm9FbWl0T25FcnJvciBmYWxzZSAtLW5vSW1wbGljaXRBbnkgZmFsc2UgLS1zdHJpY3QgZmFsc2VgO1xuICAgICAgXG4gICAgICBjb25zdCB7IHN0ZGVyciB9ID0gYXdhaXQgZXhlY0FzeW5jKGNvbW1hbmQsIHsgXG4gICAgICAgIGN3ZDogdGhpcy5vcHRpb25zLnJvb3REaXIsXG4gICAgICAgIG1heEJ1ZmZlcjogMTAyNCAqIDEwMjQgKiAxMCAvLyAxME1CIGJ1ZmZlclxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIGlmIChzdGRlcnIgJiYgIXN0ZGVyci5pbmNsdWRlcygnd2FybmluZycpKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignW1JlZmxlY3Rpb25FeHRyYWN0b3JdIFR5cGVTY3JpcHQgY29tcGlsYXRpb24gd2FybmluZ3M6Jywgc3RkZXJyKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICBjb25zb2xlLndhcm4oJ1tSZWZsZWN0aW9uRXh0cmFjdG9yXSBUeXBlU2NyaXB0IGNvbXBpbGF0aW9uIGhhZCBlcnJvcnMsIGJ1dCBjb250aW51aW5nIHdpdGggcGFydGlhbCBjb21waWxhdGlvbjonLCBlcnJvci5tZXNzYWdlKTtcbiAgICAgIC8vIERvbid0IHRocm93IC0gY29udGludWUgd2l0aCB3aGF0ZXZlciB3YXMgY29tcGlsZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRmluZCBhbGwgY29tcGlsZWQgSmF2YVNjcmlwdCBmaWxlc1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBmaW5kQ29tcGlsZWRGaWxlcyh0ZW1wRGlyOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgY29uc3QgcGF0dGVybnMgPSBbXG4gICAgICBqb2luKHRlbXBEaXIsICdzcmMvY29udHJvbGxlcnMvKiovKi5qcycpLFxuICAgICAgam9pbih0ZW1wRGlyLCAnc3JjL3NlcnZpY2VzLyoqLyouanMnKSxcbiAgICAgIGpvaW4odGVtcERpciwgJ3NyYy9lbnRpdGllcy8qKi8qLmpzJyksXG4gICAgICBqb2luKHRlbXBEaXIsICdzcmMvcXVldWVzLyoqLyouanMnKSxcbiAgICAgIGpvaW4odGVtcERpciwgJ3NyYy90YXNrcy8qKi8qLmpzJyksXG4gICAgICBqb2luKHRlbXBEaXIsICdzcmMvZGkuanMnKSxcbiAgICAgIGpvaW4odGVtcERpciwgJ3NyYy8qKi9kaS5qcycpXG4gICAgXTtcblxuICAgIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykge1xuICAgICAgY29uc3QgbWF0Y2hlcyA9IGF3YWl0IGdsb2IocGF0dGVybik7XG4gICAgICBmaWxlcy5wdXNoKC4uLm1hdGNoZXMpO1xuICAgIH1cblxuICAgIHJldHVybiBbLi4ubmV3IFNldChmaWxlcyldOyAvLyBSZW1vdmUgZHVwbGljYXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgbWV0YWRhdGEgZnJvbSBjb21waWxlZCBKYXZhU2NyaXB0IGZpbGVzXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGV4dHJhY3RGcm9tQ29tcGlsZWRGaWxlcyhcbiAgICBmaWxlczogc3RyaW5nW10sIFxuICAgIHRlbXBEaXI6IHN0cmluZ1xuICApOiBQcm9taXNlPFJlZmxlY3Rpb25FeHRyYWN0aW9uUmVzdWx0PiB7XG4gICAgY29uc3QgcmVzdWx0OiBSZWZsZWN0aW9uRXh0cmFjdGlvblJlc3VsdCA9IHtcbiAgICAgIG1vZHVsZXM6IFtdLFxuICAgICAgZW50aXRpZXM6IFtdLFxuICAgICAgY2FwYWJpbGl0aWVzOiBbXSxcbiAgICAgIHJlc291cmNlSW50ZW50czogW11cbiAgICB9O1xuXG4gICAgZm9yIChjb25zdCBmaWxlUGF0aCBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZmlsZUhhc2ggPSB0aGlzLmNhbGN1bGF0ZUZpbGVIYXNoKGZpbGVQYXRoKTtcbiAgICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcmVsYXRpdmUodGVtcERpciwgZmlsZVBhdGgpO1xuXG4gICAgICAgIC8vIENoZWNrIGNhY2hlIGZpcnN0XG4gICAgICAgIGlmICghdGhpcy5vcHRpb25zLnNraXBDYWNoZSAmJiB0aGlzLmNhY2hlLmhhcyhyZWxhdGl2ZVBhdGgpKSB7XG4gICAgICAgICAgY29uc3QgY2FjaGVkID0gdGhpcy5jYWNoZS5nZXQocmVsYXRpdmVQYXRoKSE7XG4gICAgICAgICAgaWYgKGNhY2hlZC5oYXNoID09PSBmaWxlSGFzaCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFtSZWZsZWN0aW9uRXh0cmFjdG9yXSBVc2luZyBjYWNoZWQgcmVzdWx0IGZvciAke3JlbGF0aXZlUGF0aH1gKTtcbiAgICAgICAgICAgIHRoaXMubWVyZ2VSZXN1bHRzKHJlc3VsdCwgY2FjaGVkLnJlc3VsdCk7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBFeHRyYWN0IGZyb20gZmlsZVxuICAgICAgICBjb25zdCBmaWxlUmVzdWx0ID0gYXdhaXQgdGhpcy5leHRyYWN0RnJvbUZpbGUoZmlsZVBhdGgsIHRlbXBEaXIpO1xuICAgICAgICBcbiAgICAgICAgLy8gQ2FjaGUgdGhlIHJlc3VsdFxuICAgICAgICB0aGlzLmNhY2hlLnNldChyZWxhdGl2ZVBhdGgsIHsgaGFzaDogZmlsZUhhc2gsIHJlc3VsdDogZmlsZVJlc3VsdCB9KTtcbiAgICAgICAgXG4gICAgICAgIC8vIE1lcmdlIHdpdGggb3ZlcmFsbCByZXN1bHRcbiAgICAgICAgdGhpcy5tZXJnZVJlc3VsdHMocmVzdWx0LCBmaWxlUmVzdWx0KTtcbiAgICAgICAgXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIGNvbnNvbGUud2FybihgW1JlZmxlY3Rpb25FeHRyYWN0b3JdIEZhaWxlZCB0byBleHRyYWN0IGZyb20gJHtmaWxlUGF0aH06YCwgZXJyb3IubWVzc2FnZSk7XG4gICAgICAgIC8vIENvbnRpbnVlIHdpdGggb3RoZXIgZmlsZXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgbWV0YWRhdGEgZnJvbSBhIHNpbmdsZSBjb21waWxlZCBmaWxlXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGV4dHJhY3RGcm9tRmlsZShcbiAgICBmaWxlUGF0aDogc3RyaW5nLCBcbiAgICB0ZW1wRGlyOiBzdHJpbmdcbiAgKTogUHJvbWlzZTxSZWZsZWN0aW9uRXh0cmFjdGlvblJlc3VsdD4ge1xuICAgIGNvbnN0IHJlc3VsdDogUmVmbGVjdGlvbkV4dHJhY3Rpb25SZXN1bHQgPSB7XG4gICAgICBtb2R1bGVzOiBbXSxcbiAgICAgIGVudGl0aWVzOiBbXSxcbiAgICAgIGNhcGFiaWxpdGllczogW10sXG4gICAgICByZXNvdXJjZUludGVudHM6IFtdXG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICAvLyBDbGVhciByZXF1aXJlIGNhY2hlIHRvIGVuc3VyZSBmcmVzaCBpbXBvcnRcbiAgICAgIGRlbGV0ZSByZXF1aXJlLmNhY2hlW3JlcXVpcmUucmVzb2x2ZShmaWxlUGF0aCldO1xuICAgICAgXG4gICAgICAvLyBJbXBvcnQgdGhlIGNvbXBpbGVkIG1vZHVsZVxuICAgICAgY29uc3QgbW9kdWxlID0gcmVxdWlyZShmaWxlUGF0aCk7XG4gICAgICBcbiAgICAgIC8vIEV4dHJhY3QgbWV0YWRhdGEgZnJvbSBhbGwgZXhwb3J0ZWQgY2xhc3Nlc1xuICAgICAgZm9yIChjb25zdCBbZXhwb3J0TmFtZSwgZXhwb3J0ZWRJdGVtXSBvZiBPYmplY3QuZW50cmllcyhtb2R1bGUpKSB7XG4gICAgICAgIGlmICh0eXBlb2YgZXhwb3J0ZWRJdGVtID09PSAnZnVuY3Rpb24nICYmIGV4cG9ydGVkSXRlbS5wcm90b3R5cGUpIHtcbiAgICAgICAgICBjb25zdCBjbGFzc0NvbnN0cnVjdG9yID0gZXhwb3J0ZWRJdGVtIGFzIEZ1bmN0aW9uICYgeyBwcm90b3R5cGU6IGFueSB9O1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIEV4dHJhY3QgY29udHJvbGxlciBtZXRhZGF0YVxuICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJNZXRhID0gUmVmbGVjdC5nZXRNZXRhZGF0YShNRVRBREFUQV9LRVlTLkNPTlRST0xMRVIsIGNsYXNzQ29uc3RydWN0b3IpO1xuICAgICAgICAgIGlmIChjb250cm9sbGVyTWV0YSkge1xuICAgICAgICAgICAgY29uc3QgY2FwYWJpbGl0eSA9IHRoaXMuZXh0cmFjdENvbnRyb2xsZXJDYXBhYmlsaXR5KFxuICAgICAgICAgICAgICBjbGFzc0NvbnN0cnVjdG9yLCBcbiAgICAgICAgICAgICAgY29udHJvbGxlck1ldGEsIFxuICAgICAgICAgICAgICBleHBvcnROYW1lLFxuICAgICAgICAgICAgICBmaWxlUGF0aCxcbiAgICAgICAgICAgICAgdGVtcERpclxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHJlc3VsdC5jYXBhYmlsaXRpZXMucHVzaChjYXBhYmlsaXR5KTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBFeHRyYWN0IHNlcnZpY2UgbWV0YWRhdGFcbiAgICAgICAgICBjb25zdCBzZXJ2aWNlTWV0YSA9IFJlZmxlY3QuZ2V0TWV0YWRhdGEoTUVUQURBVEFfS0VZUy5TRVJWSUNFLCBjbGFzc0NvbnN0cnVjdG9yKTtcbiAgICAgICAgICBpZiAoc2VydmljZU1ldGEpIHtcbiAgICAgICAgICAgIC8vIFNlcnZpY2VzIHdpbGwgYmUgcGFydCBvZiBtb2R1bGUgcHJvdmlkZXJzXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1JlZmxlY3Rpb25FeHRyYWN0b3JdIEZvdW5kIHNlcnZpY2U6ICR7ZXhwb3J0TmFtZX1gKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBFeHRyYWN0IHF1ZXVlIG1ldGFkYXRhXG4gICAgICAgICAgY29uc3QgcXVldWVNZXRhID0gUmVmbGVjdC5nZXRNZXRhZGF0YShNRVRBREFUQV9LRVlTLlFVRVVFLCBjbGFzc0NvbnN0cnVjdG9yKTtcbiAgICAgICAgICBpZiAocXVldWVNZXRhKSB7XG4gICAgICAgICAgICBjb25zdCBjYXBhYmlsaXR5ID0gdGhpcy5leHRyYWN0UXVldWVDYXBhYmlsaXR5KFxuICAgICAgICAgICAgICBjbGFzc0NvbnN0cnVjdG9yLFxuICAgICAgICAgICAgICBxdWV1ZU1ldGEsXG4gICAgICAgICAgICAgIGV4cG9ydE5hbWUsXG4gICAgICAgICAgICAgIGZpbGVQYXRoLFxuICAgICAgICAgICAgICB0ZW1wRGlyXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgcmVzdWx0LmNhcGFiaWxpdGllcy5wdXNoKGNhcGFiaWxpdHkpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIEV4dHJhY3QgdGFzayBtZXRhZGF0YVxuICAgICAgICAgIGNvbnN0IHRhc2tNZXRhID0gUmVmbGVjdC5nZXRNZXRhZGF0YShNRVRBREFUQV9LRVlTLlRBU0ssIGNsYXNzQ29uc3RydWN0b3IpO1xuICAgICAgICAgIGlmICh0YXNrTWV0YSkge1xuICAgICAgICAgICAgY29uc3QgY2FwYWJpbGl0eSA9IHRoaXMuZXh0cmFjdFRhc2tDYXBhYmlsaXR5KFxuICAgICAgICAgICAgICBjbGFzc0NvbnN0cnVjdG9yLFxuICAgICAgICAgICAgICB0YXNrTWV0YSxcbiAgICAgICAgICAgICAgZXhwb3J0TmFtZSxcbiAgICAgICAgICAgICAgZmlsZVBhdGgsXG4gICAgICAgICAgICAgIHRlbXBEaXJcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICByZXN1bHQuY2FwYWJpbGl0aWVzLnB1c2goY2FwYWJpbGl0eSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICBjb25zb2xlLndhcm4oYFtSZWZsZWN0aW9uRXh0cmFjdG9yXSBFcnJvciBwcm9jZXNzaW5nICR7ZmlsZVBhdGh9OmAsIGVycm9yLm1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBjb250cm9sbGVyIGNhcGFiaWxpdHkgd2l0aCByb3V0ZXNcbiAgICovXG4gIHByaXZhdGUgZXh0cmFjdENvbnRyb2xsZXJDYXBhYmlsaXR5KFxuICAgIGNsYXNzQ29uc3RydWN0b3I6IGFueSxcbiAgICBjb250cm9sbGVyTWV0YTogYW55LFxuICAgIGV4cG9ydE5hbWU6IHN0cmluZyxcbiAgICBmaWxlUGF0aDogc3RyaW5nLFxuICAgIHRlbXBEaXI6IHN0cmluZ1xuICApOiBDYXBhYmlsaXR5RGVzY3JpcHRvciB7XG4gICAgY29uc3Qgcm91dGVzID0gdGhpcy5leHRyYWN0Um91dGVzRnJvbUNsYXNzKGNsYXNzQ29uc3RydWN0b3IpO1xuICAgIGNvbnN0IHNvdXJjZUZpbGUgPSB0aGlzLmdldFJlbGF0aXZlU291cmNlUGF0aChmaWxlUGF0aCwgdGVtcERpcik7XG4gICAgY29uc3QgcmVzb3VyY2VJbnRlbnRzID0gdGhpcy5leHRyYWN0UmVzb3VyY2VJbnRlbnRzKGNvbnRyb2xsZXJNZXRhLmNvbmZpZyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IGAke2NvbnRyb2xsZXJNZXRhLm5hbWUudG9Mb3dlckNhc2UoKX06Y29udHJvbGxlcjoke2V4cG9ydE5hbWV9YCxcbiAgICAgIGtpbmQ6ICdjb250cm9sbGVyJyxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBleHBvcnROYW1lLFxuICAgICAgcm91dGluZzoge1xuICAgICAgICBiYXNlUGF0aDogY29udHJvbGxlck1ldGEuYmFzZVBhdGgsXG4gICAgICAgIHJvdXRlc1xuICAgICAgfSxcbiAgICAgIHJlcXVpcmVzOiB7XG4gICAgICAgIHJlc291cmNlSW50ZW50c1xuICAgICAgfSxcbiAgICAgIHRhZ3M6IFtdXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IHJvdXRlcyBmcm9tIGNvbnRyb2xsZXIgY2xhc3MgbWV0aG9kcyB1c2luZyByZWZsZWN0aW9uXG4gICAqL1xuICBwcml2YXRlIGV4dHJhY3RSb3V0ZXNGcm9tQ2xhc3MoY2xhc3NDb25zdHJ1Y3RvcjogYW55KSB7XG4gICAgY29uc3Qgcm91dGVzID0gW107XG4gICAgY29uc3QgcHJvdG90eXBlID0gY2xhc3NDb25zdHJ1Y3Rvci5wcm90b3R5cGU7XG4gICAgXG4gICAgLy8gR2V0IGFsbCBtZXRob2QgbmFtZXNcbiAgICBjb25zdCBtZXRob2ROYW1lcyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHByb3RvdHlwZSlcbiAgICAgIC5maWx0ZXIobmFtZSA9PiBuYW1lICE9PSAnY29uc3RydWN0b3InICYmIHR5cGVvZiBwcm90b3R5cGVbbmFtZV0gPT09ICdmdW5jdGlvbicpO1xuXG4gICAgY29uc29sZS5sb2coYFtSZWZsZWN0aW9uRXh0cmFjdG9yXSBDaGVja2luZyAke21ldGhvZE5hbWVzLmxlbmd0aH0gbWV0aG9kcyBmb3Igcm91dGUgbWV0YWRhdGFgKTtcblxuICAgIGZvciAoY29uc3QgbWV0aG9kTmFtZSBvZiBtZXRob2ROYW1lcykge1xuICAgICAgY29uc3Qgcm91dGVNZXRhID0gUmVmbGVjdC5nZXRNZXRhZGF0YShNRVRBREFUQV9LRVlTLlJPVVRFLCBwcm90b3R5cGUsIG1ldGhvZE5hbWUpO1xuICAgICAgaWYgKHJvdXRlTWV0YSkge1xuICAgICAgICBjb25zb2xlLmxvZyhgW1JlZmxlY3Rpb25FeHRyYWN0b3JdIEZvdW5kIHJvdXRlIG1ldGFkYXRhIGZvciAke21ldGhvZE5hbWV9OmAsIHJvdXRlTWV0YSk7XG4gICAgICAgIFxuICAgICAgICAvLyBDb252ZXJ0IGF1dGhvcml6ZXIgdG8gcHJvcGVyIGZvcm1hdFxuICAgICAgICBsZXQgYXV0aG9yaXplcjogQ2FwYWJpbGl0eVJvdXRlWydhdXRob3JpemVyJ10gPSByb3V0ZU1ldGEub3B0aW9ucy5hdXRob3JpemVyIHx8ICdBV1NfSUFNJztcbiAgICAgICAgaWYgKHR5cGVvZiBhdXRob3JpemVyID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgIC8vIEhhbmRsZSBBdXRob3JpemVyVHlwZU1ldGFkYXRhIG9iamVjdHNcbiAgICAgICAgICBhdXRob3JpemVyID0ge1xuICAgICAgICAgICAgdHlwZTogYXV0aG9yaXplci50eXBlIHx8ICdBV1NfSUFNJyxcbiAgICAgICAgICAgIG5hbWU6IGF1dGhvcml6ZXIubmFtZSxcbiAgICAgICAgICAgIGdyb3VwczogYXV0aG9yaXplci5ncm91cHMsXG4gICAgICAgICAgICByZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnOiBhdXRob3JpemVyLnJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWdcbiAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcm91dGVzLnB1c2goe1xuICAgICAgICAgIG1ldGhvZDogcm91dGVNZXRhLm1ldGhvZCxcbiAgICAgICAgICBwYXRoOiByb3V0ZU1ldGEucGF0aCxcbiAgICAgICAgICBhdXRob3JpemVyLFxuICAgICAgICAgIHRhcmdldDogcm91dGVNZXRhLm9wdGlvbnMudGFyZ2V0IHx8ICdmdW5jdGlvbicsXG4gICAgICAgICAgdGFyZ2V0TmFtZTogcm91dGVNZXRhLm9wdGlvbnMudGFyZ2V0ICYmIHJvdXRlTWV0YS5vcHRpb25zLnRhcmdldCAhPT0gJ2Z1bmN0aW9uJyBcbiAgICAgICAgICAgID8gcm91dGVNZXRhLnBhdGgucmVwbGFjZSgvXlxcLy8sICcnKSBcbiAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgIHZhbGlkYXRpb25zOiByb3V0ZU1ldGEub3B0aW9ucy52YWxpZGF0aW9ucyxcbiAgICAgICAgICBwYXJhbWV0ZXJzOiByb3V0ZU1ldGEucGFyYW1ldGVyc1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhgW1JlZmxlY3Rpb25FeHRyYWN0b3JdIEV4dHJhY3RlZCAke3JvdXRlcy5sZW5ndGh9IHJvdXRlcyBmcm9tIGNsYXNzYCk7XG4gICAgcmV0dXJuIHJvdXRlcztcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IHF1ZXVlIGNhcGFiaWxpdHlcbiAgICovXG4gIHByaXZhdGUgZXh0cmFjdFF1ZXVlQ2FwYWJpbGl0eShcbiAgICBfY2xhc3NDb25zdHJ1Y3RvcjogYW55LFxuICAgIHF1ZXVlTWV0YTogYW55LFxuICAgIGV4cG9ydE5hbWU6IHN0cmluZyxcbiAgICBmaWxlUGF0aDogc3RyaW5nLFxuICAgIHRlbXBEaXI6IHN0cmluZ1xuICApOiBDYXBhYmlsaXR5RGVzY3JpcHRvciB7XG4gICAgY29uc3Qgc291cmNlRmlsZSA9IHRoaXMuZ2V0UmVsYXRpdmVTb3VyY2VQYXRoKGZpbGVQYXRoLCB0ZW1wRGlyKTtcbiAgICBjb25zdCByZXNvdXJjZUludGVudHMgPSB0aGlzLmV4dHJhY3RSZXNvdXJjZUludGVudHMocXVldWVNZXRhLmNvbmZpZyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IGAke3F1ZXVlTWV0YS5uYW1lLnRvTG93ZXJDYXNlKCl9OnF1ZXVlOiR7ZXhwb3J0TmFtZX1gLFxuICAgICAga2luZDogJ3F1ZXVlJyxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBleHBvcnROYW1lLFxuICAgICAgcXVldWU6IHsgbmFtZTogcXVldWVNZXRhLm5hbWUgfSxcbiAgICAgIHJlcXVpcmVzOiB7XG4gICAgICAgIHJlc291cmNlSW50ZW50c1xuICAgICAgfSxcbiAgICAgIHRhZ3M6IFtdXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IHRhc2sgY2FwYWJpbGl0eVxuICAgKi9cbiAgcHJpdmF0ZSBleHRyYWN0VGFza0NhcGFiaWxpdHkoXG4gICAgX2NsYXNzQ29uc3RydWN0b3I6IGFueSxcbiAgICB0YXNrTWV0YTogYW55LFxuICAgIGV4cG9ydE5hbWU6IHN0cmluZyxcbiAgICBmaWxlUGF0aDogc3RyaW5nLFxuICAgIHRlbXBEaXI6IHN0cmluZ1xuICApOiBDYXBhYmlsaXR5RGVzY3JpcHRvciB7XG4gICAgY29uc3Qgc291cmNlRmlsZSA9IHRoaXMuZ2V0UmVsYXRpdmVTb3VyY2VQYXRoKGZpbGVQYXRoLCB0ZW1wRGlyKTtcbiAgICBjb25zdCByZXNvdXJjZUludGVudHMgPSB0aGlzLmV4dHJhY3RSZXNvdXJjZUludGVudHModGFza01ldGEuY29uZmlnKTtcblxuICAgIHJldHVybiB7XG4gICAgICBpZDogYCR7dGFza01ldGEubmFtZS50b0xvd2VyQ2FzZSgpfTp0YXNrOiR7ZXhwb3J0TmFtZX1gLFxuICAgICAga2luZDogJ3Rhc2snLFxuICAgICAgc291cmNlRmlsZSxcbiAgICAgIGV4cG9ydE5hbWUsXG4gICAgICBzY2hlZHVsZTogeyByYXRlOiB0YXNrTWV0YS5jb25maWcuc2NoZWR1bGUgfSxcbiAgICAgIHJlcXVpcmVzOiB7XG4gICAgICAgIHJlc291cmNlSW50ZW50c1xuICAgICAgfSxcbiAgICAgIHRhZ3M6IFtdXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IHJlc291cmNlIGludGVudHMgZnJvbSBjb25maWcgdXNpbmcgcHJvcGVyIHRyYW5zbGF0aW9uXG4gICAqL1xuICBwcml2YXRlIGV4dHJhY3RSZXNvdXJjZUludGVudHMoY29uZmlnOiBhbnkpOiBSZXNvdXJjZUludGVudFtdIHtcbiAgICBpZiAoIWNvbmZpZy5yZXNvdXJjZUFjY2Vzcykge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gdHJhbnNsYXRlUmVzb3VyY2VBY2Nlc3NUb0ludGVudHMoY29uZmlnLnJlc291cmNlQWNjZXNzKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS53YXJuKCdbUmVmbGVjdGlvbkV4dHJhY3Rvcl0gRmFpbGVkIHRvIHRyYW5zbGF0ZSByZXNvdXJjZSBhY2Nlc3M6JywgZXJyb3IpO1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IGVudGl0eSBtZXRhZGF0YSBmcm9tIGdsb2JhbCByZWdpc3RyeVxuICAgKi9cbiAgcHJpdmF0ZSBleHRyYWN0RW50aXR5TWV0YWRhdGEocmVzdWx0OiBSZWZsZWN0aW9uRXh0cmFjdGlvblJlc3VsdCk6IHZvaWQge1xuICAgIGNvbnN0IGdsb2JhbEVudGl0eVJlZ2lzdHJ5ID0gKGdsb2JhbCBhcyBhbnkpLl9fZncyNEVudGl0eVJlZ2lzdHJ5O1xuICAgIGlmICghZ2xvYmFsRW50aXR5UmVnaXN0cnkpIHtcbiAgICAgIGNvbnNvbGUubG9nKCdbUmVmbGVjdGlvbkV4dHJhY3Rvcl0gTm8gZ2xvYmFsIGVudGl0eSByZWdpc3RyeSBmb3VuZCcpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKGBbUmVmbGVjdGlvbkV4dHJhY3Rvcl0gRm91bmQgJHtnbG9iYWxFbnRpdHlSZWdpc3RyeS5zaXplfSBlbnRpdGllcyBpbiBnbG9iYWwgcmVnaXN0cnlgKTtcbiAgICBcbiAgICBmb3IgKGNvbnN0IFtlbnRpdHlOYW1lLCBtZXRhZGF0YV0gb2YgZ2xvYmFsRW50aXR5UmVnaXN0cnkuZW50cmllcygpKSB7XG4gICAgICBjb25zdCBlbnRpdHlEZXNjcmlwdG9yOiBFbnRpdHlEZXNjcmlwdG9yID0ge1xuICAgICAgICBuYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICBzY2hlbWFQcm92aWRlclRva2VuOiBtZXRhZGF0YS5zY2hlbWFQcm92aWRlclRva2VuLFxuICAgICAgICB0YWdzOiBtZXRhZGF0YS50YWdzIHx8IFtdXG4gICAgICB9O1xuICAgICAgXG4gICAgICByZXN1bHQuZW50aXRpZXMucHVzaChlbnRpdHlEZXNjcmlwdG9yKTtcbiAgICAgIGNvbnNvbGUubG9nKGBbUmVmbGVjdGlvbkV4dHJhY3Rvcl0gQWRkZWQgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFV0aWxpdHkgZnVuY3Rpb25zXG4gICAqL1xuICBwcml2YXRlIGdldFJlbGF0aXZlU291cmNlUGF0aChjb21waWxlZFBhdGg6IHN0cmluZywgdGVtcERpcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSByZWxhdGl2ZSh0ZW1wRGlyLCBjb21waWxlZFBhdGgpO1xuICAgIHJldHVybiByZWxhdGl2ZVBhdGgucmVwbGFjZSgvXFwuanMkLywgJy50cycpOyAvLyBDb252ZXJ0IGJhY2sgdG8gLnRzIGV4dGVuc2lvblxuICB9XG5cbiAgcHJpdmF0ZSBtZXJnZVJlc3VsdHModGFyZ2V0OiBSZWZsZWN0aW9uRXh0cmFjdGlvblJlc3VsdCwgc291cmNlOiBSZWZsZWN0aW9uRXh0cmFjdGlvblJlc3VsdCk6IHZvaWQge1xuICAgIHRhcmdldC5tb2R1bGVzLnB1c2goLi4uc291cmNlLm1vZHVsZXMpO1xuICAgIHRhcmdldC5lbnRpdGllcy5wdXNoKC4uLnNvdXJjZS5lbnRpdGllcyk7XG4gICAgdGFyZ2V0LmNhcGFiaWxpdGllcy5wdXNoKC4uLnNvdXJjZS5jYXBhYmlsaXRpZXMpO1xuICAgIHRhcmdldC5yZXNvdXJjZUludGVudHMucHVzaCguLi5zb3VyY2UucmVzb3VyY2VJbnRlbnRzKTtcbiAgfVxuXG4gIHByaXZhdGUgY2FsY3VsYXRlRmlsZUhhc2goZmlsZVBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgY29udGVudCA9IHJlYWRGaWxlU3luYyhmaWxlUGF0aCk7XG4gICAgcmV0dXJuIGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShjb250ZW50KS5kaWdlc3QoJ2hleCcpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVEaXJlY3RvcnkoZGlyOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWV4aXN0c1N5bmMoZGlyKSkge1xuICAgICAgbWtkaXJTeW5jKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBsb2FkQ2FjaGUoKTogdm9pZCB7XG4gICAgdHJ5IHtcbiAgICAgIGlmIChleGlzdHNTeW5jKHRoaXMuY2FjaGVGaWxlKSkge1xuICAgICAgICBjb25zdCBjYWNoZURhdGEgPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyh0aGlzLmNhY2hlRmlsZSwgJ3V0Zi04JykpO1xuICAgICAgICB0aGlzLmNhY2hlID0gbmV3IE1hcChPYmplY3QuZW50cmllcyhjYWNoZURhdGEpKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS53YXJuKCdbUmVmbGVjdGlvbkV4dHJhY3Rvcl0gRmFpbGVkIHRvIGxvYWQgY2FjaGUsIHN0YXJ0aW5nIGZyZXNoJyk7XG4gICAgICB0aGlzLmNhY2hlID0gbmV3IE1hcCgpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2F2ZUNhY2hlKCk6IHZvaWQge1xuICAgIHRyeSB7XG4gICAgICB0aGlzLmVuc3VyZURpcmVjdG9yeShkaXJuYW1lKHRoaXMuY2FjaGVGaWxlKSk7XG4gICAgICBjb25zdCBjYWNoZURhdGEgPSBPYmplY3QuZnJvbUVudHJpZXModGhpcy5jYWNoZS5lbnRyaWVzKCkpO1xuICAgICAgd3JpdGVGaWxlU3luYyh0aGlzLmNhY2hlRmlsZSwgSlNPTi5zdHJpbmdpZnkoY2FjaGVEYXRhLCBudWxsLCAyKSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUud2FybignW1JlZmxlY3Rpb25FeHRyYWN0b3JdIEZhaWxlZCB0byBzYXZlIGNhY2hlOicsIGVycm9yKTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==