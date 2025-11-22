"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Helper = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const logging_1 = require("../logging");
const utils_1 = require("../utils");
const crypto_1 = require("crypto");
/**
 * Simple timer utility for measuring durations
 */
class Timer {
    startTime;
    constructor() {
        this.startTime = Date.now();
    }
    elapsed() {
        return Date.now() - this.startTime;
    }
    static start() {
        return new Timer();
    }
}
class Helper {
    static logger = (0, logging_1.createLogger)(Helper.name);
    static hydrateConfig(config, prefix = "APP") {
        Object.keys(process.env)
            .filter(key => key.startsWith(prefix))
            .forEach(key => {
            const newKey = key.replace(new RegExp('^' + prefix + '_'), '').toLowerCase().replace(/_./g, x => x[1].toUpperCase());
            if (config[newKey] === undefined) {
                config[newKey] = process.env[key];
            }
        });
    }
    static async registerControllersFromModule(module, handlerRegistrar) {
        const basePath = module.getBasePath();
        Helper.logger.debug("registerControllersFromModule::: base-path: " + basePath);
        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = (0, path_1.relative)('./', basePath);
        const controllersPath = (0, path_1.resolve)(relativePath, module.getControllersDirectory());
        // TODO: support for controller path prefix [ e.g. module-name/controller-path ]
        // make sure that the controller path exists
        if ((0, fs_1.existsSync)(controllersPath)) {
            Helper.logger.debug("registerControllersFromModule::: module-controllers-path: " + controllersPath);
            Helper.registerHandlers(controllersPath, handlerRegistrar);
        }
        else {
            Helper.logger.warn("registerControllersFromModule::: module-controllers-path does not exist: " + controllersPath);
        }
    }
    static async registerQueuesFromModule(module, handlerRegistrar) {
        const basePath = module.getBasePath();
        Helper.logger.debug("registerQueuesFromModule::: base-path: " + basePath);
        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = (0, path_1.relative)('./', basePath);
        const queuesPath = (0, path_1.resolve)(relativePath, module.getQueuesDirectory());
        const handlersPath = module.getQueueFileNames();
        Helper.logger.debug("registerQueuesFromModule::: module-queues-path: " + queuesPath);
        Helper.registerHandlers(queuesPath, handlerRegistrar, handlersPath);
    }
    static async registerTasksFromModule(module, handlerRegistrar) {
        const basePath = module.getBasePath();
        Helper.logger.debug("registerTasksFromModule::: base-path: " + basePath);
        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = (0, path_1.relative)('./', basePath);
        const tasksPath = (0, path_1.resolve)(relativePath, module.getTasksDirectory());
        const handlersPath = module.getTaskFileNames();
        Helper.logger.debug("registerTasksFromModule::: module-tasks-path: " + tasksPath);
        Helper.registerHandlers(tasksPath, handlerRegistrar, handlersPath);
    }
    static scanControllerSourceFilesFrom(directoryPath) {
        Helper.logger.debug("Scanning TS source files from path: ", directoryPath);
        // Resolve the absolute path
        const sourceDirectory = (0, path_1.resolve)(directoryPath);
        // Get all the files in the handler directory
        const allDirFiles = (0, fs_1.readdirSync)(sourceDirectory, { recursive: true });
        // Filter the test files and only include the source files
        // We also look for JS files as the FW24-modules are compiled to JS
        const sourceFilePaths = allDirFiles.filter((file) => {
            if (file.endsWith(".d.ts") // ignore TypeScript declaration files
                || file.endsWith(".test.ts") // ignore test files
                || file.endsWith(".test.js") // ignore test files
                || file.endsWith(".integration.test.ts") // ignore integration test files
                || file.endsWith(".integration.test.js") // ignore integration test files
                || file.endsWith(".spec.ts") // ignore spec files
                || file.endsWith(".spec.js") // ignore spec files
            ) {
                return false;
            }
            return file.endsWith(".ts") || file.endsWith(".js");
        });
        return sourceFilePaths;
    }
    static isFifoQueueProps(props) {
        if (props.fifo) {
            return true;
        }
        if (props.deduplicationScope) {
            return true;
        }
        if (props.fifoThroughputLimit) {
            return true;
        }
        if (props.contentBasedDeduplication) {
            return true;
        }
        if (props.queueName && (0, utils_1.isString)(props.queueName) && props.queueName.endsWith('.fifo')) {
            return true;
        }
        return false;
    }
    /**
     * Load a single handler file and extract its descriptors
     * @private
     */
    static async loadHandlerFile(handlerPath, handlerDirectory) {
        const result = {
            success: false,
            handlerPath,
            descriptors: []
        };
        try {
            Helper.logger.debug(`[Parallel] Loading handler file: ${handlerPath}`);
            // Dynamically import the controller file
            const fullPath = (0, path_1.join)(handlerDirectory, handlerPath);
            const module = await Promise.resolve(`${fullPath}`).then(s => __importStar(require(s)));
            // Calculate module hash
            const fileBuffer = (0, fs_1.readFileSync)(fullPath);
            const moduleHash = (0, crypto_1.createHash)('md5').update(fileBuffer).digest('hex');
            Helper.logger.debug(`[Parallel] Loaded module ${handlerPath}, hash: ${moduleHash}`);
            // Find and extract handler classes
            for (const exportedItem of Object.values(module)) {
                if (typeof exportedItem === "function" && exportedItem.name !== "handler") {
                    const descriptor = {
                        handlerClass: exportedItem,
                        fileName: handlerPath,
                        filePath: handlerDirectory,
                        handlerHash: moduleHash
                    };
                    result.descriptors.push(descriptor);
                    Helper.logger.debug(`[Parallel] Found handler class in ${handlerPath}: ${exportedItem.name}`);
                    break; // Only take the first handler class per file
                }
            }
            result.success = true;
        }
        catch (error) {
            result.success = false;
            result.error = error;
            Helper.logger.error(`[Parallel] Failed to load handler file: ${handlerPath}`, error);
        }
        return result;
    }
    /**
     * Register handlers from a directory with parallel file loading
     * Files are loaded in parallel for speed, but construct registration is sequential for CDK safety
     *
     * @param path - Directory path containing handler files
     * @param handlerRegistrar - Callback to register each handler
     * @param files - Optional array of specific files to load (if empty, scans directory)
     * @param config - Configuration for parallel loading
     *
     * @example
     * // Use default concurrency (5)
     * await Helper.registerHandlers('./src/controllers', registerController);
     *
     * // Override concurrency via environment variable FW24_HANDLER_LOAD_CONCURRENCY
     * process.env.FW24_HANDLER_LOAD_CONCURRENCY = '10';
     *
     * // Or pass config directly
     * await Helper.registerHandlers('./src/controllers', registerController, [], { maxConcurrency: 5 });
     */
    static async registerHandlers(path, handlerRegistrar, files = [], config = {}) {
        // Validate inputs
        if (typeof handlerRegistrar !== 'function') {
            throw new Error('handlerRegistrar must be a function');
        }
        const loadTimer = Timer.start();
        Helper.logger.info(`Registering Lambda Handlers from: ${path}`);
        // Resolve the absolute path
        const handlerDirectory = (0, path_1.resolve)(path);
        // Determine which files to load
        let handlerPaths = [];
        if (files.length !== 0) {
            handlerPaths = files;
        }
        else {
            // Filter the files to only include TypeScript files
            handlerPaths = Helper.scanControllerSourceFilesFrom(path);
        }
        if (handlerPaths.length === 0) {
            Helper.logger.warn(`No handler files found in: ${path}`);
            return;
        }
        // Concurrency configuration
        // Default: 5 (conservative, avoids module resolution contention for large files like di.ts)
        // Override via config.maxConcurrency or env var FW24_HANDLER_LOAD_CONCURRENCY
        let envConcurrency = undefined;
        if (process.env.FW24_HANDLER_LOAD_CONCURRENCY) {
            const parsed = parseInt(process.env.FW24_HANDLER_LOAD_CONCURRENCY, 10);
            if (!isNaN(parsed) && parsed > 0) {
                envConcurrency = parsed;
            }
            else {
                Helper.logger.warn(`Invalid FW24_HANDLER_LOAD_CONCURRENCY: "${process.env.FW24_HANDLER_LOAD_CONCURRENCY}". Using default.`);
            }
        }
        const maxConcurrency = config.maxConcurrency ?? envConcurrency ?? 5;
        const failFast = config.failFast ?? false;
        // Clamp to safe range
        const safeConcurrency = Math.max(1, Math.min(50, maxConcurrency));
        if (safeConcurrency !== maxConcurrency) {
            Helper.logger.warn(`Concurrency ${maxConcurrency} clamped to ${safeConcurrency} (valid range: 1-50)`);
        }
        const totalChunks = Math.ceil(handlerPaths.length / safeConcurrency);
        Helper.logger.info(`📦 Loading ${handlerPaths.length} handler file(s) ` +
            `[concurrency: ${safeConcurrency}, chunks: ${totalChunks}]...`);
        // PHASE 1: Load all files in parallel (with concurrency limit)
        const loadResults = [];
        const errors = [];
        // Process files in chunks to limit concurrency
        for (let i = 0; i < handlerPaths.length; i += safeConcurrency) {
            const chunk = handlerPaths.slice(i, i + safeConcurrency);
            const chunkNum = Math.floor(i / safeConcurrency) + 1;
            const chunkStartTime = Date.now();
            // Show which files we're loading in this chunk
            const chunkFileNames = chunk.map(p => (0, path_1.basename)(p, '.ts')).join(', ');
            Helper.logger.info(`   [${chunkNum}/${totalChunks}] Loading: ${chunkFileNames}`);
            const chunkResults = await Promise.all(chunk.map(handlerPath => Helper.loadHandlerFile(handlerPath, handlerDirectory)));
            loadResults.push(...chunkResults);
            // Show chunk completion with timing
            const chunkTimeMs = Date.now() - chunkStartTime;
            const loadedSoFar = loadResults.length;
            const chunkDescriptors = chunkResults.reduce((sum, r) => sum + r.descriptors.length, 0);
            Helper.logger.info(`   [${chunkNum}/${totalChunks}] ✓ Loaded ${loadedSoFar}/${handlerPaths.length} ` +
                `(+${chunkDescriptors} handler${chunkDescriptors !== 1 ? 's' : ''}) in ${chunkTimeMs}ms`);
            // Check for errors in this chunk
            const chunkErrors = chunkResults.filter(r => !r.success);
            if (chunkErrors.length > 0) {
                chunkErrors.forEach(r => {
                    if (r.error) {
                        errors.push({ file: r.handlerPath, error: r.error });
                        Helper.logger.error(`   ❌ Failed to load ${(0, path_1.basename)(r.handlerPath)}: ${r.error.message}`);
                    }
                });
                if (failFast) {
                    Helper.logger.error(`   ❌ Fail-fast enabled, stopping after ${errors.length} error(s)`);
                    break;
                }
            }
        }
        const loadTimeMs = loadTimer.elapsed();
        // Report loading results
        const successCount = loadResults.filter(r => r.success).length;
        const failCount = errors.length;
        const totalDescriptors = loadResults.reduce((sum, r) => sum + r.descriptors.length, 0);
        Helper.logger.info(`✓ Loaded ${successCount}/${handlerPaths.length} files in ${loadTimeMs.toFixed(0)}ms ` +
            `(${totalDescriptors} handlers found${failCount > 0 ? `, ${failCount} failed` : ''})`);
        // Fail if we have errors
        if (errors.length > 0) {
            Helper.logger.error(`❌ Failed to load ${errors.length} handler file(s):`);
            errors.forEach(({ file, error }) => {
                Helper.logger.error(`  - ${file}: ${error.message}`);
            });
            throw new Error(`Failed to load ${errors.length} handler file(s). First error: ${errors[0].error.message}`);
        }
        // PHASE 2: Register handlers with CDK
        // Note: JavaScript is single-threaded, so even "parallel" registration is serialized by event loop
        // But we keep it sequential to be safe with CDK/Fw24 internal state management
        const registerTimer = Timer.start();
        Helper.logger.info(`🔧 Registering ${totalDescriptors} handler(s) with CDK...`);
        let registeredCount = 0;
        const registrationErrors = [];
        let lastProgressLog = Date.now();
        const progressIntervalMs = 2000; // Log progress every 2 seconds
        for (const result of loadResults) {
            if (!result.success)
                continue;
            for (const descriptor of result.descriptors) {
                try {
                    Helper.logger.debug(`Registering ${descriptor.handlerClass.name} from ${descriptor.fileName}`);
                    await handlerRegistrar(descriptor);
                    registeredCount++;
                    // Show progress periodically for long-running registrations
                    const now = Date.now();
                    if (now - lastProgressLog > progressIntervalMs && registeredCount < totalDescriptors) {
                        const elapsedMs = registerTimer.elapsed();
                        const avgMs = elapsedMs / registeredCount;
                        const remainingCount = totalDescriptors - registeredCount;
                        const estimatedRemainingMs = Math.round(avgMs * remainingCount);
                        Helper.logger.info(`   ⏳ Progress: ${registeredCount}/${totalDescriptors} registered ` +
                            `(~${Math.round(estimatedRemainingMs / 1000)}s remaining)`);
                        lastProgressLog = now;
                    }
                }
                catch (error) {
                    const err = error;
                    Helper.logger.error(`Failed to register handler ${descriptor.handlerClass.name} from ${descriptor.fileName}`, error);
                    registrationErrors.push({ descriptor, error: err });
                    if (failFast) {
                        throw new Error(`Failed to register handler ${descriptor.handlerClass.name}: ${err.message}`);
                    }
                }
            }
        }
        const registerTimeMs = registerTimer.elapsed();
        // Final report
        if (registrationErrors.length > 0) {
            Helper.logger.error(`❌ Failed to register ${registrationErrors.length} handler(s):`);
            registrationErrors.forEach(({ descriptor, error }) => {
                Helper.logger.error(`  - ${descriptor.handlerClass.name}: ${error.message}`);
            });
            throw new Error(`Failed to register ${registrationErrors.length} handler(s). ` +
                `First error: ${registrationErrors[0].error.message}`);
        }
        const totalTimeMs = loadTimeMs + registerTimeMs;
        const totalTimeSec = (totalTimeMs / 1000).toFixed(1);
        Helper.logger.info(`✅ Successfully registered ${registeredCount} handler(s)\n` +
            `   📊 Load time: ${(loadTimeMs / 1000).toFixed(1)}s | ` +
            `Register time: ${(registerTimeMs / 1000).toFixed(1)}s | ` +
            `Total: ${totalTimeSec}s` +
            `${handlerPaths.length > 1 ? ` (${(totalTimeMs / handlerPaths.length).toFixed(0)}ms per file)` : ''}`);
    }
}
exports.Helper = Helper;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGVscGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvcmUvaGVscGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDJCQUErRTtBQUMvRSwrQkFBeUU7QUFHekUsd0NBQXVEO0FBRXZELG9DQUFvQztBQUNwQyxtQ0FBb0M7QUE2QnBDOztHQUVHO0FBQ0gsTUFBTSxLQUFLO0lBQ0MsU0FBUyxDQUFTO0lBRTFCO1FBQ0ksSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDaEMsQ0FBQztJQUVELE9BQU87UUFDSCxPQUFPLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDO0lBQ3ZDLENBQUM7SUFFRCxNQUFNLENBQUMsS0FBSztRQUNSLE9BQU8sSUFBSSxLQUFLLEVBQUUsQ0FBQztJQUN2QixDQUFDO0NBQ0o7QUFJRCxNQUFhLE1BQU07SUFFZixNQUFNLENBQVUsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7SUFFbkQsTUFBTSxDQUFDLGFBQWEsQ0FBSSxNQUFTLEVBQUUsTUFBTSxHQUFHLEtBQUs7UUFDN0MsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDO2FBQ25CLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUM7YUFDckMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFO1lBQ1gsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLE1BQU0sQ0FBQyxHQUFHLEdBQUcsTUFBTSxHQUFHLEdBQUcsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLEVBQUUs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QUFNLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLFVBQVUsQ0FBQyxZQUFZLENBQUMsSUFBSSxLQUFLLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1lBQ2pGLENBQUMsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxJQUFJLEtBQUssQ0FDWCxzQkFBc0Isa0JBQWtCLENBQUMsTUFBTSxlQUFlO2dCQUM5RCxnQkFBZ0Isa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUN4RCxDQUFDO1FBQ04sQ0FBQztRQUVELE1BQU0sV0FBVyxHQUFHLFVBQVUsR0FBRyxjQUFjLENBQUM7UUFDaEQsTUFBTSxZQUFZLEdBQUcsQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3JELE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUNkLDZCQUE2QixlQUFlLGVBQWU7WUFDM0Qsb0JBQW9CLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTTtZQUN4RCxrQkFBa0IsQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNO1lBQzFELFVBQVUsWUFBWSxHQUFHO1lBQ3pCLEdBQUcsWUFBWSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxXQUFXLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FDeEcsQ0FBQztJQUNOLENBQUM7O0FBdFpMLHdCQXVaQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHJlYWRkaXJTeW5jLCBleGlzdHNTeW5jLCByZWFkRmlsZSwgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZSwgam9pbiwgcmVsYXRpdmUsIGJhc2VuYW1lIGFzIHBhdGhCYXNlbmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgSGFuZGxlckRlc2NyaXB0b3IgZnJvbSBcIi4uL2ludGVyZmFjZXMvaGFuZGxlci1kZXNjcmlwdG9yXCI7XG5pbXBvcnQgeyBJRncyNE1vZHVsZSB9IGZyb20gXCIuL3J1bnRpbWUvbW9kdWxlXCI7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIsIExvZ0R1cmF0aW9uIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IFF1ZXVlUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuaW1wb3J0IHsgaXNTdHJpbmcgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwiY3J5cHRvXCI7XG5cbi8qKlxuICogUmVzdWx0IG9mIGxvYWRpbmcgYSBzaW5nbGUgaGFuZGxlciBmaWxlXG4gKi9cbmludGVyZmFjZSBIYW5kbGVyTG9hZFJlc3VsdCB7XG4gICAgc3VjY2VzczogYm9vbGVhbjtcbiAgICBoYW5kbGVyUGF0aDogc3RyaW5nO1xuICAgIGRlc2NyaXB0b3JzOiBIYW5kbGVyRGVzY3JpcHRvcltdO1xuICAgIGVycm9yPzogRXJyb3I7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgcGFyYWxsZWwgaGFuZGxlciBsb2FkaW5nXG4gKi9cbmludGVyZmFjZSBQYXJhbGxlbExvYWRDb25maWcge1xuICAgIC8qKlxuICAgICAqIE1heGltdW0gbnVtYmVyIG9mIGZpbGVzIHRvIGxvYWQgaW4gcGFyYWxsZWxcbiAgICAgKiBAZGVmYXVsdCAxMFxuICAgICAqL1xuICAgIG1heENvbmN1cnJlbmN5PzogbnVtYmVyO1xuICAgIFxuICAgIC8qKlxuICAgICAqIFdoZXRoZXIgdG8gZmFpbCBmYXN0IG9uIGZpcnN0IGVycm9yIG9yIGNvbGxlY3QgYWxsIGVycm9yc1xuICAgICAqIEBkZWZhdWx0IGZhbHNlIChjb2xsZWN0IGFsbCBlcnJvcnMpXG4gICAgICovXG4gICAgZmFpbEZhc3Q/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFNpbXBsZSB0aW1lciB1dGlsaXR5IGZvciBtZWFzdXJpbmcgZHVyYXRpb25zXG4gKi9cbmNsYXNzIFRpbWVyIHtcbiAgICBwcml2YXRlIHN0YXJ0VGltZTogbnVtYmVyO1xuXG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHRoaXMuc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICB9XG5cbiAgICBlbGFwc2VkKCk6IG51bWJlciB7XG4gICAgICAgIHJldHVybiBEYXRlLm5vdygpIC0gdGhpcy5zdGFydFRpbWU7XG4gICAgfVxuXG4gICAgc3RhdGljIHN0YXJ0KCk6IFRpbWVyIHtcbiAgICAgICAgcmV0dXJuIG5ldyBUaW1lcigpO1xuICAgIH1cbn1cblxuXG5cbmV4cG9ydCBjbGFzcyBIZWxwZXIge1xuXG4gICAgc3RhdGljIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihIZWxwZXIubmFtZSk7XG5cbiAgICBzdGF0aWMgaHlkcmF0ZUNvbmZpZzxUPihjb25maWc6IFQsIHByZWZpeCA9IFwiQVBQXCIpIHtcbiAgICAgICAgT2JqZWN0LmtleXMocHJvY2Vzcy5lbnYpXG4gICAgICAgICAgICAuZmlsdGVyKGtleSA9PiBrZXkuc3RhcnRzV2l0aChwcmVmaXgpKVxuICAgICAgICAgICAgLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBuZXdLZXkgPSBrZXkucmVwbGFjZShuZXcgUmVnRXhwKCdeJyArIHByZWZpeCArICdfJyksICcnKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18uL2csIHggPT4geFsgMSBdLnRvVXBwZXJDYXNlKCkpO1xuICAgICAgICAgICAgICAgIGlmICgoY29uZmlnIGFzIGFueSlbIG5ld0tleSBdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgKGNvbmZpZyBhcyBhbnkpWyBuZXdLZXkgXSA9IHByb2Nlc3MuZW52WyBrZXkgXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBzdGF0aWMgYXN5bmMgcmVnaXN0ZXJDb250cm9sbGVyc0Zyb21Nb2R1bGUobW9kdWxlOiBJRncyNE1vZHVsZSwgaGFuZGxlclJlZ2lzdHJhcjogKGhhbmRsZXJJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4gdm9pZCkge1xuICAgICAgICBjb25zdCBiYXNlUGF0aCA9IG1vZHVsZS5nZXRCYXNlUGF0aCgpO1xuXG4gICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoXCJyZWdpc3RlckNvbnRyb2xsZXJzRnJvbU1vZHVsZTo6OiBiYXNlLXBhdGg6IFwiICsgYmFzZVBhdGgpO1xuXG4gICAgICAgIC8vIHJlbGF0aXZlIHBhdGggZnJvbSB0aGUgcGxhY2Ugd2hlcmUgdGhlIHNjcmlwdCBpcyBnZXR0aW5nIGV4ZWN1dGVkIGkuZSBpbmRleC50cyBpbiBhcHAtcm9vdFxuICAgICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSByZWxhdGl2ZSgnLi8nLCBiYXNlUGF0aCk7XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJzUGF0aCA9IHJlc29sdmUocmVsYXRpdmVQYXRoLCBtb2R1bGUuZ2V0Q29udHJvbGxlcnNEaXJlY3RvcnkoKSk7XG5cbiAgICAgICAgLy8gVE9ETzogc3VwcG9ydCBmb3IgY29udHJvbGxlciBwYXRoIHByZWZpeCBbIGUuZy4gbW9kdWxlLW5hbWUvY29udHJvbGxlci1wYXRoIF1cblxuICAgICAgICAvLyBtYWtlIHN1cmUgdGhhdCB0aGUgY29udHJvbGxlciBwYXRoIGV4aXN0c1xuICAgICAgICBpZiAoZXhpc3RzU3luYyhjb250cm9sbGVyc1BhdGgpKSB7XG5cbiAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoXCJyZWdpc3RlckNvbnRyb2xsZXJzRnJvbU1vZHVsZTo6OiBtb2R1bGUtY29udHJvbGxlcnMtcGF0aDogXCIgKyBjb250cm9sbGVyc1BhdGgpO1xuXG4gICAgICAgICAgICBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycyhjb250cm9sbGVyc1BhdGgsIGhhbmRsZXJSZWdpc3RyYXIpO1xuXG4gICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAgIEhlbHBlci5sb2dnZXIud2FybihcInJlZ2lzdGVyQ29udHJvbGxlcnNGcm9tTW9kdWxlOjo6IG1vZHVsZS1jb250cm9sbGVycy1wYXRoIGRvZXMgbm90IGV4aXN0OiBcIiArIGNvbnRyb2xsZXJzUGF0aCk7XG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIHN0YXRpYyBhc3luYyByZWdpc3RlclF1ZXVlc0Zyb21Nb2R1bGUobW9kdWxlOiBJRncyNE1vZHVsZSwgaGFuZGxlclJlZ2lzdHJhcjogKGhhbmRsZXJJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4gdm9pZCkge1xuICAgICAgICBjb25zdCBiYXNlUGF0aCA9IG1vZHVsZS5nZXRCYXNlUGF0aCgpO1xuXG4gICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoXCJyZWdpc3RlclF1ZXVlc0Zyb21Nb2R1bGU6OjogYmFzZS1wYXRoOiBcIiArIGJhc2VQYXRoKTtcblxuICAgICAgICAvLyByZWxhdGl2ZSBwYXRoIGZyb20gdGhlIHBsYWNlIHdoZXJlIHRoZSBzY3JpcHQgaXMgZ2V0dGluZyBleGVjdXRlZCBpLmUgaW5kZXgudHMgaW4gYXBwLXJvb3RcbiAgICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcmVsYXRpdmUoJy4vJywgYmFzZVBhdGgpO1xuICAgICAgICBjb25zdCBxdWV1ZXNQYXRoID0gcmVzb2x2ZShyZWxhdGl2ZVBhdGgsIG1vZHVsZS5nZXRRdWV1ZXNEaXJlY3RvcnkoKSk7XG4gICAgICAgIGNvbnN0IGhhbmRsZXJzUGF0aCA9IG1vZHVsZS5nZXRRdWV1ZUZpbGVOYW1lcygpO1xuXG4gICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoXCJyZWdpc3RlclF1ZXVlc0Zyb21Nb2R1bGU6OjogbW9kdWxlLXF1ZXVlcy1wYXRoOiBcIiArIHF1ZXVlc1BhdGgpO1xuXG4gICAgICAgIEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKHF1ZXVlc1BhdGgsIGhhbmRsZXJSZWdpc3RyYXIsIGhhbmRsZXJzUGF0aCk7XG4gICAgfVxuXG4gICAgc3RhdGljIGFzeW5jIHJlZ2lzdGVyVGFza3NGcm9tTW9kdWxlKG1vZHVsZTogSUZ3MjRNb2R1bGUsIGhhbmRsZXJSZWdpc3RyYXI6IChoYW5kbGVySW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHZvaWQpIHtcbiAgICAgICAgY29uc3QgYmFzZVBhdGggPSBtb2R1bGUuZ2V0QmFzZVBhdGgoKTtcblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwicmVnaXN0ZXJUYXNrc0Zyb21Nb2R1bGU6OjogYmFzZS1wYXRoOiBcIiArIGJhc2VQYXRoKTtcblxuICAgICAgICAvLyByZWxhdGl2ZSBwYXRoIGZyb20gdGhlIHBsYWNlIHdoZXJlIHRoZSBzY3JpcHQgaXMgZ2V0dGluZyBleGVjdXRlZCBpLmUgaW5kZXgudHMgaW4gYXBwLXJvb3RcbiAgICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcmVsYXRpdmUoJy4vJywgYmFzZVBhdGgpO1xuICAgICAgICBjb25zdCB0YXNrc1BhdGggPSByZXNvbHZlKHJlbGF0aXZlUGF0aCwgbW9kdWxlLmdldFRhc2tzRGlyZWN0b3J5KCkpO1xuICAgICAgICBjb25zdCBoYW5kbGVyc1BhdGggPSBtb2R1bGUuZ2V0VGFza0ZpbGVOYW1lcygpO1xuXG4gICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoXCJyZWdpc3RlclRhc2tzRnJvbU1vZHVsZTo6OiBtb2R1bGUtdGFza3MtcGF0aDogXCIgKyB0YXNrc1BhdGgpO1xuXG4gICAgICAgIEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKHRhc2tzUGF0aCwgaGFuZGxlclJlZ2lzdHJhciwgaGFuZGxlcnNQYXRoKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgc2NhbkNvbnRyb2xsZXJTb3VyY2VGaWxlc0Zyb20oZGlyZWN0b3J5UGF0aDogc3RyaW5nKSB7XG4gICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoXCJTY2FubmluZyBUUyBzb3VyY2UgZmlsZXMgZnJvbSBwYXRoOiBcIiwgZGlyZWN0b3J5UGF0aCk7XG4gICAgICAgIC8vIFJlc29sdmUgdGhlIGFic29sdXRlIHBhdGhcbiAgICAgICAgY29uc3Qgc291cmNlRGlyZWN0b3J5ID0gcmVzb2x2ZShkaXJlY3RvcnlQYXRoKTtcbiAgICAgICAgLy8gR2V0IGFsbCB0aGUgZmlsZXMgaW4gdGhlIGhhbmRsZXIgZGlyZWN0b3J5XG4gICAgICAgIGNvbnN0IGFsbERpckZpbGVzID0gcmVhZGRpclN5bmMoc291cmNlRGlyZWN0b3J5LCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KSBhcyBzdHJpbmdbXTtcblxuICAgICAgICAvLyBGaWx0ZXIgdGhlIHRlc3QgZmlsZXMgYW5kIG9ubHkgaW5jbHVkZSB0aGUgc291cmNlIGZpbGVzXG4gICAgICAgIC8vIFdlIGFsc28gbG9vayBmb3IgSlMgZmlsZXMgYXMgdGhlIEZXMjQtbW9kdWxlcyBhcmUgY29tcGlsZWQgdG8gSlNcbiAgICAgICAgY29uc3Qgc291cmNlRmlsZVBhdGhzID0gYWxsRGlyRmlsZXMuZmlsdGVyKChmaWxlKSA9PiB7XG5cbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICBmaWxlLmVuZHNXaXRoKFwiLmQudHNcIikgLy8gaWdub3JlIFR5cGVTY3JpcHQgZGVjbGFyYXRpb24gZmlsZXNcbiAgICAgICAgICAgICAgICB8fCBmaWxlLmVuZHNXaXRoKFwiLnRlc3QudHNcIikgLy8gaWdub3JlIHRlc3QgZmlsZXNcbiAgICAgICAgICAgICAgICB8fCBmaWxlLmVuZHNXaXRoKFwiLnRlc3QuanNcIikgLy8gaWdub3JlIHRlc3QgZmlsZXNcbiAgICAgICAgICAgICAgICB8fCBmaWxlLmVuZHNXaXRoKFwiLmludGVncmF0aW9uLnRlc3QudHNcIikgLy8gaWdub3JlIGludGVncmF0aW9uIHRlc3QgZmlsZXNcbiAgICAgICAgICAgICAgICB8fCBmaWxlLmVuZHNXaXRoKFwiLmludGVncmF0aW9uLnRlc3QuanNcIikgLy8gaWdub3JlIGludGVncmF0aW9uIHRlc3QgZmlsZXNcbiAgICAgICAgICAgICAgICB8fCBmaWxlLmVuZHNXaXRoKFwiLnNwZWMudHNcIikgLy8gaWdub3JlIHNwZWMgZmlsZXNcbiAgICAgICAgICAgICAgICB8fCBmaWxlLmVuZHNXaXRoKFwiLnNwZWMuanNcIikgLy8gaWdub3JlIHNwZWMgZmlsZXNcbiAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIGZpbGUuZW5kc1dpdGgoXCIudHNcIikgfHwgZmlsZS5lbmRzV2l0aChcIi5qc1wiKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHNvdXJjZUZpbGVQYXRocztcbiAgICB9XG5cbiAgICBzdGF0aWMgaXNGaWZvUXVldWVQcm9wcyhwcm9wczogUXVldWVQcm9wcykge1xuICAgICAgICBpZiAocHJvcHMuZmlmbykge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHByb3BzLmRlZHVwbGljYXRpb25TY29wZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHByb3BzLmZpZm9UaHJvdWdocHV0TGltaXQpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwcm9wcy5jb250ZW50QmFzZWREZWR1cGxpY2F0aW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocHJvcHMucXVldWVOYW1lICYmIGlzU3RyaW5nKHByb3BzLnF1ZXVlTmFtZSkgJiYgcHJvcHMucXVldWVOYW1lLmVuZHNXaXRoKCcuZmlmbycpKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBMb2FkIGEgc2luZ2xlIGhhbmRsZXIgZmlsZSBhbmQgZXh0cmFjdCBpdHMgZGVzY3JpcHRvcnNcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHByaXZhdGUgc3RhdGljIGFzeW5jIGxvYWRIYW5kbGVyRmlsZShcbiAgICAgICAgaGFuZGxlclBhdGg6IHN0cmluZyxcbiAgICAgICAgaGFuZGxlckRpcmVjdG9yeTogc3RyaW5nXG4gICAgKTogUHJvbWlzZTxIYW5kbGVyTG9hZFJlc3VsdD4ge1xuICAgICAgICBjb25zdCByZXN1bHQ6IEhhbmRsZXJMb2FkUmVzdWx0ID0ge1xuICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgICBoYW5kbGVyUGF0aCxcbiAgICAgICAgICAgIGRlc2NyaXB0b3JzOiBbXVxuICAgICAgICB9O1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKGBbUGFyYWxsZWxdIExvYWRpbmcgaGFuZGxlciBmaWxlOiAke2hhbmRsZXJQYXRofWApO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBEeW5hbWljYWxseSBpbXBvcnQgdGhlIGNvbnRyb2xsZXIgZmlsZVxuICAgICAgICAgICAgY29uc3QgZnVsbFBhdGggPSBqb2luKGhhbmRsZXJEaXJlY3RvcnksIGhhbmRsZXJQYXRoKTtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IGF3YWl0IGltcG9ydChmdWxsUGF0aCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENhbGN1bGF0ZSBtb2R1bGUgaGFzaFxuICAgICAgICAgICAgY29uc3QgZmlsZUJ1ZmZlciA9IHJlYWRGaWxlU3luYyhmdWxsUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBtb2R1bGVIYXNoID0gY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGZpbGVCdWZmZXIpLmRpZ2VzdCgnaGV4Jyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoYFtQYXJhbGxlbF0gTG9hZGVkIG1vZHVsZSAke2hhbmRsZXJQYXRofSwgaGFzaDogJHttb2R1bGVIYXNofWApO1xuXG4gICAgICAgICAgICAvLyBGaW5kIGFuZCBleHRyYWN0IGhhbmRsZXIgY2xhc3Nlc1xuICAgICAgICAgICAgZm9yIChjb25zdCBleHBvcnRlZEl0ZW0gb2YgT2JqZWN0LnZhbHVlcyhtb2R1bGUpKSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRlZEl0ZW0gPT09IFwiZnVuY3Rpb25cIiAmJiBleHBvcnRlZEl0ZW0ubmFtZSAhPT0gXCJoYW5kbGVyXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGVzY3JpcHRvcjogSGFuZGxlckRlc2NyaXB0b3IgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYW5kbGVyQ2xhc3M6IGV4cG9ydGVkSXRlbSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBoYW5kbGVyUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVQYXRoOiBoYW5kbGVyRGlyZWN0b3J5LFxuICAgICAgICAgICAgICAgICAgICAgICAgaGFuZGxlckhhc2g6IG1vZHVsZUhhc2hcbiAgICAgICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgICAgICByZXN1bHQuZGVzY3JpcHRvcnMucHVzaChkZXNjcmlwdG9yKTtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhgW1BhcmFsbGVsXSBGb3VuZCBoYW5kbGVyIGNsYXNzIGluICR7aGFuZGxlclBhdGh9OiAke2V4cG9ydGVkSXRlbS5uYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICBicmVhazsgLy8gT25seSB0YWtlIHRoZSBmaXJzdCBoYW5kbGVyIGNsYXNzIHBlciBmaWxlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXN1bHQuc3VjY2VzcyA9IHRydWU7XG4gICAgICAgICAgICBcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIHJlc3VsdC5zdWNjZXNzID0gZmFsc2U7XG4gICAgICAgICAgICByZXN1bHQuZXJyb3IgPSBlcnJvciBhcyBFcnJvcjtcbiAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZXJyb3IoYFtQYXJhbGxlbF0gRmFpbGVkIHRvIGxvYWQgaGFuZGxlciBmaWxlOiAke2hhbmRsZXJQYXRofWAsIGVycm9yKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVnaXN0ZXIgaGFuZGxlcnMgZnJvbSBhIGRpcmVjdG9yeSB3aXRoIHBhcmFsbGVsIGZpbGUgbG9hZGluZ1xuICAgICAqIEZpbGVzIGFyZSBsb2FkZWQgaW4gcGFyYWxsZWwgZm9yIHNwZWVkLCBidXQgY29uc3RydWN0IHJlZ2lzdHJhdGlvbiBpcyBzZXF1ZW50aWFsIGZvciBDREsgc2FmZXR5XG4gICAgICogXG4gICAgICogQHBhcmFtIHBhdGggLSBEaXJlY3RvcnkgcGF0aCBjb250YWluaW5nIGhhbmRsZXIgZmlsZXNcbiAgICAgKiBAcGFyYW0gaGFuZGxlclJlZ2lzdHJhciAtIENhbGxiYWNrIHRvIHJlZ2lzdGVyIGVhY2ggaGFuZGxlclxuICAgICAqIEBwYXJhbSBmaWxlcyAtIE9wdGlvbmFsIGFycmF5IG9mIHNwZWNpZmljIGZpbGVzIHRvIGxvYWQgKGlmIGVtcHR5LCBzY2FucyBkaXJlY3RvcnkpXG4gICAgICogQHBhcmFtIGNvbmZpZyAtIENvbmZpZ3VyYXRpb24gZm9yIHBhcmFsbGVsIGxvYWRpbmdcbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIC8vIFVzZSBkZWZhdWx0IGNvbmN1cnJlbmN5ICg1KVxuICAgICAqIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKCcuL3NyYy9jb250cm9sbGVycycsIHJlZ2lzdGVyQ29udHJvbGxlcik7XG4gICAgICogXG4gICAgICogLy8gT3ZlcnJpZGUgY29uY3VycmVuY3kgdmlhIGVudmlyb25tZW50IHZhcmlhYmxlIEZXMjRfSEFORExFUl9MT0FEX0NPTkNVUlJFTkNZXG4gICAgICogcHJvY2Vzcy5lbnYuRlcyNF9IQU5ETEVSX0xPQURfQ09OQ1VSUkVOQ1kgPSAnMTAnO1xuICAgICAqIFxuICAgICAqIC8vIE9yIHBhc3MgY29uZmlnIGRpcmVjdGx5XG4gICAgICogYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMoJy4vc3JjL2NvbnRyb2xsZXJzJywgcmVnaXN0ZXJDb250cm9sbGVyLCBbXSwgeyBtYXhDb25jdXJyZW5jeTogNSB9KTtcbiAgICAgKi9cbiAgICBzdGF0aWMgYXN5bmMgcmVnaXN0ZXJIYW5kbGVycyhcbiAgICAgICAgcGF0aDogc3RyaW5nLCBcbiAgICAgICAgaGFuZGxlclJlZ2lzdHJhcjogKGhhbmRsZXJJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4sIFxuICAgICAgICBmaWxlczogc3RyaW5nW10gPSBbXSxcbiAgICAgICAgY29uZmlnOiBQYXJhbGxlbExvYWRDb25maWcgPSB7fVxuICAgICkge1xuICAgICAgICAvLyBWYWxpZGF0ZSBpbnB1dHNcbiAgICAgICAgaWYgKHR5cGVvZiBoYW5kbGVyUmVnaXN0cmFyICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2hhbmRsZXJSZWdpc3RyYXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGxvYWRUaW1lciA9IFRpbWVyLnN0YXJ0KCk7XG4gICAgICAgIEhlbHBlci5sb2dnZXIuaW5mbyhgUmVnaXN0ZXJpbmcgTGFtYmRhIEhhbmRsZXJzIGZyb206ICR7cGF0aH1gKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFJlc29sdmUgdGhlIGFic29sdXRlIHBhdGhcbiAgICAgICAgY29uc3QgaGFuZGxlckRpcmVjdG9yeSA9IHJlc29sdmUocGF0aCk7XG5cbiAgICAgICAgLy8gRGV0ZXJtaW5lIHdoaWNoIGZpbGVzIHRvIGxvYWRcbiAgICAgICAgbGV0IGhhbmRsZXJQYXRoczogc3RyaW5nW10gPSBbXTtcbiAgICAgICAgaWYgKGZpbGVzLmxlbmd0aCAhPT0gMCkge1xuICAgICAgICAgICAgaGFuZGxlclBhdGhzID0gZmlsZXM7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBGaWx0ZXIgdGhlIGZpbGVzIHRvIG9ubHkgaW5jbHVkZSBUeXBlU2NyaXB0IGZpbGVzXG4gICAgICAgICAgICBoYW5kbGVyUGF0aHMgPSBIZWxwZXIuc2NhbkNvbnRyb2xsZXJTb3VyY2VGaWxlc0Zyb20ocGF0aCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaGFuZGxlclBhdGhzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci53YXJuKGBObyBoYW5kbGVyIGZpbGVzIGZvdW5kIGluOiAke3BhdGh9YCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb25jdXJyZW5jeSBjb25maWd1cmF0aW9uXG4gICAgICAgIC8vIERlZmF1bHQ6IDUgKGNvbnNlcnZhdGl2ZSwgYXZvaWRzIG1vZHVsZSByZXNvbHV0aW9uIGNvbnRlbnRpb24gZm9yIGxhcmdlIGZpbGVzIGxpa2UgZGkudHMpXG4gICAgICAgIC8vIE92ZXJyaWRlIHZpYSBjb25maWcubWF4Q29uY3VycmVuY3kgb3IgZW52IHZhciBGVzI0X0hBTkRMRVJfTE9BRF9DT05DVVJSRU5DWVxuICAgICAgICBsZXQgZW52Q29uY3VycmVuY3k6IG51bWJlciB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgICAgICAgaWYgKHByb2Nlc3MuZW52LkZXMjRfSEFORExFUl9MT0FEX0NPTkNVUlJFTkNZKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUludChwcm9jZXNzLmVudi5GVzI0X0hBTkRMRVJfTE9BRF9DT05DVVJSRU5DWSwgMTApO1xuICAgICAgICAgICAgaWYgKCFpc05hTihwYXJzZWQpICYmIHBhcnNlZCA+IDApIHtcbiAgICAgICAgICAgICAgICBlbnZDb25jdXJyZW5jeSA9IHBhcnNlZDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgSGVscGVyLmxvZ2dlci53YXJuKFxuICAgICAgICAgICAgICAgICAgICBgSW52YWxpZCBGVzI0X0hBTkRMRVJfTE9BRF9DT05DVVJSRU5DWTogXCIke3Byb2Nlc3MuZW52LkZXMjRfSEFORExFUl9MT0FEX0NPTkNVUlJFTkNZfVwiLiBVc2luZyBkZWZhdWx0LmBcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zdCBtYXhDb25jdXJyZW5jeSA9IGNvbmZpZy5tYXhDb25jdXJyZW5jeSA/PyBlbnZDb25jdXJyZW5jeSA/PyA1O1xuICAgICAgICBjb25zdCBmYWlsRmFzdCA9IGNvbmZpZy5mYWlsRmFzdCA/PyBmYWxzZTtcblxuICAgICAgICAvLyBDbGFtcCB0byBzYWZlIHJhbmdlXG4gICAgICAgIGNvbnN0IHNhZmVDb25jdXJyZW5jeSA9IE1hdGgubWF4KDEsIE1hdGgubWluKDUwLCBtYXhDb25jdXJyZW5jeSkpO1xuICAgICAgICBcbiAgICAgICAgaWYgKHNhZmVDb25jdXJyZW5jeSAhPT0gbWF4Q29uY3VycmVuY3kpIHtcbiAgICAgICAgICAgIEhlbHBlci5sb2dnZXIud2FybihgQ29uY3VycmVuY3kgJHttYXhDb25jdXJyZW5jeX0gY2xhbXBlZCB0byAke3NhZmVDb25jdXJyZW5jeX0gKHZhbGlkIHJhbmdlOiAxLTUwKWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdG90YWxDaHVua3MgPSBNYXRoLmNlaWwoaGFuZGxlclBhdGhzLmxlbmd0aCAvIHNhZmVDb25jdXJyZW5jeSk7XG4gICAgICAgIEhlbHBlci5sb2dnZXIuaW5mbyhcbiAgICAgICAgICAgIGDwn5OmIExvYWRpbmcgJHtoYW5kbGVyUGF0aHMubGVuZ3RofSBoYW5kbGVyIGZpbGUocykgYCArXG4gICAgICAgICAgICBgW2NvbmN1cnJlbmN5OiAke3NhZmVDb25jdXJyZW5jeX0sIGNodW5rczogJHt0b3RhbENodW5rc31dLi4uYFxuICAgICAgICApO1xuXG4gICAgICAgIC8vIFBIQVNFIDE6IExvYWQgYWxsIGZpbGVzIGluIHBhcmFsbGVsICh3aXRoIGNvbmN1cnJlbmN5IGxpbWl0KVxuICAgICAgICBjb25zdCBsb2FkUmVzdWx0czogSGFuZGxlckxvYWRSZXN1bHRbXSA9IFtdO1xuICAgICAgICBjb25zdCBlcnJvcnM6IEFycmF5PHsgZmlsZTogc3RyaW5nOyBlcnJvcjogRXJyb3IgfT4gPSBbXTtcbiAgICAgICAgXG4gICAgICAgIC8vIFByb2Nlc3MgZmlsZXMgaW4gY2h1bmtzIHRvIGxpbWl0IGNvbmN1cnJlbmN5XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaGFuZGxlclBhdGhzLmxlbmd0aDsgaSArPSBzYWZlQ29uY3VycmVuY3kpIHtcbiAgICAgICAgICAgIGNvbnN0IGNodW5rID0gaGFuZGxlclBhdGhzLnNsaWNlKGksIGkgKyBzYWZlQ29uY3VycmVuY3kpO1xuICAgICAgICAgICAgY29uc3QgY2h1bmtOdW0gPSBNYXRoLmZsb29yKGkgLyBzYWZlQ29uY3VycmVuY3kpICsgMTtcbiAgICAgICAgICAgIGNvbnN0IGNodW5rU3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gU2hvdyB3aGljaCBmaWxlcyB3ZSdyZSBsb2FkaW5nIGluIHRoaXMgY2h1bmtcbiAgICAgICAgICAgIGNvbnN0IGNodW5rRmlsZU5hbWVzID0gY2h1bmsubWFwKHAgPT4gcGF0aEJhc2VuYW1lKHAsICcudHMnKSkuam9pbignLCAnKTtcbiAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuaW5mbyhcbiAgICAgICAgICAgICAgICBgICAgWyR7Y2h1bmtOdW19LyR7dG90YWxDaHVua3N9XSBMb2FkaW5nOiAke2NodW5rRmlsZU5hbWVzfWBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGNvbnN0IGNodW5rUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICAgICAgICAgIGNodW5rLm1hcChoYW5kbGVyUGF0aCA9PiBcbiAgICAgICAgICAgICAgICAgICAgSGVscGVyLmxvYWRIYW5kbGVyRmlsZShoYW5kbGVyUGF0aCwgaGFuZGxlckRpcmVjdG9yeSlcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBsb2FkUmVzdWx0cy5wdXNoKC4uLmNodW5rUmVzdWx0cyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFNob3cgY2h1bmsgY29tcGxldGlvbiB3aXRoIHRpbWluZ1xuICAgICAgICAgICAgY29uc3QgY2h1bmtUaW1lTXMgPSBEYXRlLm5vdygpIC0gY2h1bmtTdGFydFRpbWU7XG4gICAgICAgICAgICBjb25zdCBsb2FkZWRTb0ZhciA9IGxvYWRSZXN1bHRzLmxlbmd0aDtcbiAgICAgICAgICAgIGNvbnN0IGNodW5rRGVzY3JpcHRvcnMgPSBjaHVua1Jlc3VsdHMucmVkdWNlKChzdW0sIHIpID0+IHN1bSArIHIuZGVzY3JpcHRvcnMubGVuZ3RoLCAwKTtcbiAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuaW5mbyhcbiAgICAgICAgICAgICAgICBgICAgWyR7Y2h1bmtOdW19LyR7dG90YWxDaHVua3N9XSDinJMgTG9hZGVkICR7bG9hZGVkU29GYXJ9LyR7aGFuZGxlclBhdGhzLmxlbmd0aH0gYCArXG4gICAgICAgICAgICAgICAgYCgrJHtjaHVua0Rlc2NyaXB0b3JzfSBoYW5kbGVyJHtjaHVua0Rlc2NyaXB0b3JzICE9PSAxID8gJ3MnIDogJyd9KSBpbiAke2NodW5rVGltZU1zfW1zYFxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIGVycm9ycyBpbiB0aGlzIGNodW5rXG4gICAgICAgICAgICBjb25zdCBjaHVua0Vycm9ycyA9IGNodW5rUmVzdWx0cy5maWx0ZXIociA9PiAhci5zdWNjZXNzKTtcbiAgICAgICAgICAgIGlmIChjaHVua0Vycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgY2h1bmtFcnJvcnMuZm9yRWFjaChyID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHIuZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9ycy5wdXNoKHsgZmlsZTogci5oYW5kbGVyUGF0aCwgZXJyb3I6IHIuZXJyb3IgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmVycm9yKGAgICDinYwgRmFpbGVkIHRvIGxvYWQgJHtwYXRoQmFzZW5hbWUoci5oYW5kbGVyUGF0aCl9OiAke3IuZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgaWYgKGZhaWxGYXN0KSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZXJyb3IoYCAgIOKdjCBGYWlsLWZhc3QgZW5hYmxlZCwgc3RvcHBpbmcgYWZ0ZXIgJHtlcnJvcnMubGVuZ3RofSBlcnJvcihzKWApO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsb2FkVGltZU1zID0gbG9hZFRpbWVyLmVsYXBzZWQoKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFJlcG9ydCBsb2FkaW5nIHJlc3VsdHNcbiAgICAgICAgY29uc3Qgc3VjY2Vzc0NvdW50ID0gbG9hZFJlc3VsdHMuZmlsdGVyKHIgPT4gci5zdWNjZXNzKS5sZW5ndGg7XG4gICAgICAgIGNvbnN0IGZhaWxDb3VudCA9IGVycm9ycy5sZW5ndGg7XG4gICAgICAgIGNvbnN0IHRvdGFsRGVzY3JpcHRvcnMgPSBsb2FkUmVzdWx0cy5yZWR1Y2UoKHN1bSwgcikgPT4gc3VtICsgci5kZXNjcmlwdG9ycy5sZW5ndGgsIDApO1xuXG4gICAgICAgIEhlbHBlci5sb2dnZXIuaW5mbyhcbiAgICAgICAgICAgIGDinJMgTG9hZGVkICR7c3VjY2Vzc0NvdW50fS8ke2hhbmRsZXJQYXRocy5sZW5ndGh9IGZpbGVzIGluICR7bG9hZFRpbWVNcy50b0ZpeGVkKDApfW1zIGAgK1xuICAgICAgICAgICAgYCgke3RvdGFsRGVzY3JpcHRvcnN9IGhhbmRsZXJzIGZvdW5kJHtmYWlsQ291bnQgPiAwID8gYCwgJHtmYWlsQ291bnR9IGZhaWxlZGAgOiAnJ30pYFxuICAgICAgICApO1xuXG4gICAgICAgIC8vIEZhaWwgaWYgd2UgaGF2ZSBlcnJvcnNcbiAgICAgICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmVycm9yKGDinYwgRmFpbGVkIHRvIGxvYWQgJHtlcnJvcnMubGVuZ3RofSBoYW5kbGVyIGZpbGUocyk6YCk7XG4gICAgICAgICAgICBlcnJvcnMuZm9yRWFjaCgoeyBmaWxlLCBlcnJvciB9KSA9PiB7XG4gICAgICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5lcnJvcihgICAtICR7ZmlsZX06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgIGBGYWlsZWQgdG8gbG9hZCAke2Vycm9ycy5sZW5ndGh9IGhhbmRsZXIgZmlsZShzKS4gRmlyc3QgZXJyb3I6ICR7ZXJyb3JzWzBdLmVycm9yLm1lc3NhZ2V9YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFBIQVNFIDI6IFJlZ2lzdGVyIGhhbmRsZXJzIHdpdGggQ0RLXG4gICAgICAgIC8vIE5vdGU6IEphdmFTY3JpcHQgaXMgc2luZ2xlLXRocmVhZGVkLCBzbyBldmVuIFwicGFyYWxsZWxcIiByZWdpc3RyYXRpb24gaXMgc2VyaWFsaXplZCBieSBldmVudCBsb29wXG4gICAgICAgIC8vIEJ1dCB3ZSBrZWVwIGl0IHNlcXVlbnRpYWwgdG8gYmUgc2FmZSB3aXRoIENESy9GdzI0IGludGVybmFsIHN0YXRlIG1hbmFnZW1lbnRcbiAgICAgICAgY29uc3QgcmVnaXN0ZXJUaW1lciA9IFRpbWVyLnN0YXJ0KCk7XG4gICAgICAgIEhlbHBlci5sb2dnZXIuaW5mbyhg8J+UpyBSZWdpc3RlcmluZyAke3RvdGFsRGVzY3JpcHRvcnN9IGhhbmRsZXIocykgd2l0aCBDREsuLi5gKTtcblxuICAgICAgICBsZXQgcmVnaXN0ZXJlZENvdW50ID0gMDtcbiAgICAgICAgY29uc3QgcmVnaXN0cmF0aW9uRXJyb3JzOiBBcnJheTx7IGRlc2NyaXB0b3I6IEhhbmRsZXJEZXNjcmlwdG9yOyBlcnJvcjogRXJyb3IgfT4gPSBbXTtcbiAgICAgICAgbGV0IGxhc3RQcm9ncmVzc0xvZyA9IERhdGUubm93KCk7XG4gICAgICAgIGNvbnN0IHByb2dyZXNzSW50ZXJ2YWxNcyA9IDIwMDA7IC8vIExvZyBwcm9ncmVzcyBldmVyeSAyIHNlY29uZHNcblxuICAgICAgICBmb3IgKGNvbnN0IHJlc3VsdCBvZiBsb2FkUmVzdWx0cykge1xuICAgICAgICAgICAgaWYgKCFyZXN1bHQuc3VjY2VzcykgY29udGludWU7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgZGVzY3JpcHRvciBvZiByZXN1bHQuZGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFxuICAgICAgICAgICAgICAgICAgICAgICAgYFJlZ2lzdGVyaW5nICR7ZGVzY3JpcHRvci5oYW5kbGVyQ2xhc3MubmFtZX0gZnJvbSAke2Rlc2NyaXB0b3IuZmlsZU5hbWV9YFxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgaGFuZGxlclJlZ2lzdHJhcihkZXNjcmlwdG9yKTtcbiAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJlZENvdW50Kys7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyBTaG93IHByb2dyZXNzIHBlcmlvZGljYWxseSBmb3IgbG9uZy1ydW5uaW5nIHJlZ2lzdHJhdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vdyAtIGxhc3RQcm9ncmVzc0xvZyA+IHByb2dyZXNzSW50ZXJ2YWxNcyAmJiByZWdpc3RlcmVkQ291bnQgPCB0b3RhbERlc2NyaXB0b3JzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbGFwc2VkTXMgPSByZWdpc3RlclRpbWVyLmVsYXBzZWQoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGF2Z01zID0gZWxhcHNlZE1zIC8gcmVnaXN0ZXJlZENvdW50O1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVtYWluaW5nQ291bnQgPSB0b3RhbERlc2NyaXB0b3JzIC0gcmVnaXN0ZXJlZENvdW50O1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXN0aW1hdGVkUmVtYWluaW5nTXMgPSBNYXRoLnJvdW5kKGF2Z01zICogcmVtYWluaW5nQ291bnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5pbmZvKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICDij7MgUHJvZ3Jlc3M6ICR7cmVnaXN0ZXJlZENvdW50fS8ke3RvdGFsRGVzY3JpcHRvcnN9IHJlZ2lzdGVyZWQgYCArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCh+JHtNYXRoLnJvdW5kKGVzdGltYXRlZFJlbWFpbmluZ01zIC8gMTAwMCl9cyByZW1haW5pbmcpYFxuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RQcm9ncmVzc0xvZyA9IG5vdztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBlcnIgPSBlcnJvciBhcyBFcnJvcjtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5lcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICAgIGBGYWlsZWQgdG8gcmVnaXN0ZXIgaGFuZGxlciAke2Rlc2NyaXB0b3IuaGFuZGxlckNsYXNzLm5hbWV9IGZyb20gJHtkZXNjcmlwdG9yLmZpbGVOYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvclxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICByZWdpc3RyYXRpb25FcnJvcnMucHVzaCh7IGRlc2NyaXB0b3IsIGVycm9yOiBlcnIgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGZhaWxGYXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYEZhaWxlZCB0byByZWdpc3RlciBoYW5kbGVyICR7ZGVzY3JpcHRvci5oYW5kbGVyQ2xhc3MubmFtZX06ICR7ZXJyLm1lc3NhZ2V9YFxuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlZ2lzdGVyVGltZU1zID0gcmVnaXN0ZXJUaW1lci5lbGFwc2VkKCk7XG5cbiAgICAgICAgLy8gRmluYWwgcmVwb3J0XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb25FcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5lcnJvcihcbiAgICAgICAgICAgICAgICBg4p2MIEZhaWxlZCB0byByZWdpc3RlciAke3JlZ2lzdHJhdGlvbkVycm9ycy5sZW5ndGh9IGhhbmRsZXIocyk6YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHJlZ2lzdHJhdGlvbkVycm9ycy5mb3JFYWNoKCh7IGRlc2NyaXB0b3IsIGVycm9yIH0pID0+IHtcbiAgICAgICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmVycm9yKGAgIC0gJHtkZXNjcmlwdG9yLmhhbmRsZXJDbGFzcy5uYW1lfTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgYEZhaWxlZCB0byByZWdpc3RlciAke3JlZ2lzdHJhdGlvbkVycm9ycy5sZW5ndGh9IGhhbmRsZXIocykuIGAgK1xuICAgICAgICAgICAgICAgIGBGaXJzdCBlcnJvcjogJHtyZWdpc3RyYXRpb25FcnJvcnNbMF0uZXJyb3IubWVzc2FnZX1gXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdG90YWxUaW1lTXMgPSBsb2FkVGltZU1zICsgcmVnaXN0ZXJUaW1lTXM7XG4gICAgICAgIGNvbnN0IHRvdGFsVGltZVNlYyA9ICh0b3RhbFRpbWVNcyAvIDEwMDApLnRvRml4ZWQoMSk7XG4gICAgICAgIEhlbHBlci5sb2dnZXIuaW5mbyhcbiAgICAgICAgICAgIGDinIUgU3VjY2Vzc2Z1bGx5IHJlZ2lzdGVyZWQgJHtyZWdpc3RlcmVkQ291bnR9IGhhbmRsZXIocylcXG5gICtcbiAgICAgICAgICAgIGAgICDwn5OKIExvYWQgdGltZTogJHsobG9hZFRpbWVNcyAvIDEwMDApLnRvRml4ZWQoMSl9cyB8IGAgK1xuICAgICAgICAgICAgYFJlZ2lzdGVyIHRpbWU6ICR7KHJlZ2lzdGVyVGltZU1zIC8gMTAwMCkudG9GaXhlZCgxKX1zIHwgYCArXG4gICAgICAgICAgICBgVG90YWw6ICR7dG90YWxUaW1lU2VjfXNgICtcbiAgICAgICAgICAgIGAke2hhbmRsZXJQYXRocy5sZW5ndGggPiAxID8gYCAoJHsodG90YWxUaW1lTXMgLyBoYW5kbGVyUGF0aHMubGVuZ3RoKS50b0ZpeGVkKDApfW1zIHBlciBmaWxlKWAgOiAnJ31gXG4gICAgICAgICk7XG4gICAgfVxufSJdfQ==