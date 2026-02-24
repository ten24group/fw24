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
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const logging_1 = require("../logging");
const utils_1 = require("../utils");
const node_crypto_1 = require("node:crypto");
/**
 * Simple timer utility for measuring durations
 */
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
        const relativePath = (0, node_path_1.relative)('./', basePath);
        const controllersPath = (0, node_path_1.resolve)(relativePath, module.getControllersDirectory());
        // TODO: support for controller path prefix [ e.g. module-name/controller-path ]
        // make sure that the controller path exists
        if ((0, node_fs_1.existsSync)(controllersPath)) {
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
        const relativePath = (0, node_path_1.relative)('./', basePath);
        const queuesPath = (0, node_path_1.resolve)(relativePath, module.getQueuesDirectory());
        const handlersPath = module.getQueueFileNames();
        Helper.logger.debug("registerQueuesFromModule::: module-queues-path: " + queuesPath);
        Helper.registerHandlers(queuesPath, handlerRegistrar, handlersPath);
    }
    static async registerTasksFromModule(module, handlerRegistrar) {
        const basePath = module.getBasePath();
        Helper.logger.debug("registerTasksFromModule::: base-path: " + basePath);
        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = (0, node_path_1.relative)('./', basePath);
        const tasksPath = (0, node_path_1.resolve)(relativePath, module.getTasksDirectory());
        const handlersPath = module.getTaskFileNames();
        Helper.logger.debug("registerTasksFromModule::: module-tasks-path: " + tasksPath);
        Helper.registerHandlers(tasksPath, handlerRegistrar, handlersPath);
    }
    static scanControllerSourceFilesFrom(directoryPath) {
        Helper.logger.debug("Scanning TS source files from path: ", directoryPath);
        // Resolve the absolute path
        const sourceDirectory = (0, node_path_1.resolve)(directoryPath);
        // Get all the files in the handler directory
        const allDirFiles = (0, node_fs_1.readdirSync)(sourceDirectory, { recursive: true });
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
            const fullPath = (0, node_path_1.join)(handlerDirectory, handlerPath);
            // If in simulation mode, clear cache to support HMR
            if (process.env.SIMULATION_MODE === 'true') {
                try {
                    delete require.cache[require.resolve(fullPath)];
                }
                catch (e) { }
            }
            const module = await Promise.resolve(`${process.env.SIMULATION_MODE === 'true' ? `file://${fullPath}?update=${Date.now()}` : fullPath}`).then(s => __importStar(require(s)));
            // Calculate module hash
            const fileBuffer = (0, node_fs_1.readFileSync)(fullPath);
            const moduleHash = (0, node_crypto_1.createHash)('md5').update(fileBuffer).digest('hex');
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
        const loadTimer = utils_1.Timer.start();
        Helper.logger.info(`Registering Lambda Handlers from: ${path}`);
        // Resolve the absolute path
        const handlerDirectory = (0, node_path_1.resolve)(path);
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
            const chunkFileNames = chunk.map(p => (0, node_path_1.basename)(p, '.ts')).join(', ');
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
                        Helper.logger.error(`   ❌ Failed to load ${(0, node_path_1.basename)(r.handlerPath)}: ${r.error.message}`);
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
        const registerTimer = utils_1.Timer.start();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGVscGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvcmUvaGVscGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLHFDQUFnRTtBQUNoRSx5Q0FBOEU7QUFHOUUsd0NBQTBDO0FBRTFDLG9DQUEyQztBQUMzQyw2Q0FBeUM7QUE2QnpDOztHQUVHO0FBQ0gsTUFBYSxNQUFNO0lBRWYsTUFBTSxDQUFVLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRW5ELE1BQU0sQ0FBQyxhQUFhLENBQUksTUFBUyxFQUFFLE1BQU0sR0FBRyxLQUFLO1FBQzdDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQzthQUNuQixNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDO2FBQ3JDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRTtZQUNYLE1BQU0sTUFBTSxHQUFHLEdBQUcsQ0FBQyxPQUFPLENBQUMsSUFBSSxNQUFNLENBQUMsR0FBRyxHQUFHLE1BQU0sR0FBRyxHQUFHLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFFLENBQUMsQ0FBRSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUM7WUFDdkgsSUFBSyxNQUFjLENBQUUsTUFBTSxDQUFFLEtBQUssU0FBUyxFQUFFLENBQUM7Z0JBQ3pDLE1BQWMsQ0FBRSxNQUFNLENBQUUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFFLEdBQUcsQ0FBRSxDQUFDO1lBQ25ELENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNYLENBQUM7SUFFRCxNQUFNLENBQUMsS0FBSyxDQUFDLDZCQUE2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eW5jLCByZWFkRmlsZVN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZSwgam9pbiwgcmVsYXRpdmUsIGJhc2VuYW1lIGFzIHBhdGhCYXNlbmFtZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbmltcG9ydCBIYW5kbGVyRGVzY3JpcHRvciBmcm9tIFwiLi4vaW50ZXJmYWNlcy9oYW5kbGVyLWRlc2NyaXB0b3JcIjtcbmltcG9ydCB7IElGdzI0TW9kdWxlIH0gZnJvbSBcIi4vcnVudGltZS9tb2R1bGVcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBRdWV1ZVByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IGlzU3RyaW5nLCBUaW1lciB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gXCJub2RlOmNyeXB0b1wiO1xuXG4vKipcbiAqIFJlc3VsdCBvZiBsb2FkaW5nIGEgc2luZ2xlIGhhbmRsZXIgZmlsZVxuICovXG5pbnRlcmZhY2UgSGFuZGxlckxvYWRSZXN1bHQge1xuICAgIHN1Y2Nlc3M6IGJvb2xlYW47XG4gICAgaGFuZGxlclBhdGg6IHN0cmluZztcbiAgICBkZXNjcmlwdG9yczogSGFuZGxlckRlc2NyaXB0b3JbXTtcbiAgICBlcnJvcj86IEVycm9yO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIHBhcmFsbGVsIGhhbmRsZXIgbG9hZGluZ1xuICovXG5pbnRlcmZhY2UgUGFyYWxsZWxMb2FkQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBNYXhpbXVtIG51bWJlciBvZiBmaWxlcyB0byBsb2FkIGluIHBhcmFsbGVsXG4gICAgICogQGRlZmF1bHQgMTBcbiAgICAgKi9cbiAgICBtYXhDb25jdXJyZW5jeT86IG51bWJlcjtcbiAgICBcbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIHRvIGZhaWwgZmFzdCBvbiBmaXJzdCBlcnJvciBvciBjb2xsZWN0IGFsbCBlcnJvcnNcbiAgICAgKiBAZGVmYXVsdCBmYWxzZSAoY29sbGVjdCBhbGwgZXJyb3JzKVxuICAgICAqL1xuICAgIGZhaWxGYXN0PzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBTaW1wbGUgdGltZXIgdXRpbGl0eSBmb3IgbWVhc3VyaW5nIGR1cmF0aW9uc1xuICovXG5leHBvcnQgY2xhc3MgSGVscGVyIHtcblxuICAgIHN0YXRpYyByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoSGVscGVyLm5hbWUpO1xuXG4gICAgc3RhdGljIGh5ZHJhdGVDb25maWc8VD4oY29uZmlnOiBULCBwcmVmaXggPSBcIkFQUFwiKSB7XG4gICAgICAgIE9iamVjdC5rZXlzKHByb2Nlc3MuZW52KVxuICAgICAgICAgICAgLmZpbHRlcihrZXkgPT4ga2V5LnN0YXJ0c1dpdGgocHJlZml4KSlcbiAgICAgICAgICAgIC5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbmV3S2V5ID0ga2V5LnJlcGxhY2UobmV3IFJlZ0V4cCgnXicgKyBwcmVmaXggKyAnXycpLCAnJykudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9fLi9nLCB4ID0+IHhbIDEgXS50b1VwcGVyQ2FzZSgpKTtcbiAgICAgICAgICAgICAgICBpZiAoKGNvbmZpZyBhcyBhbnkpWyBuZXdLZXkgXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIChjb25maWcgYXMgYW55KVsgbmV3S2V5IF0gPSBwcm9jZXNzLmVudlsga2V5IF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgc3RhdGljIGFzeW5jIHJlZ2lzdGVyQ29udHJvbGxlcnNGcm9tTW9kdWxlKG1vZHVsZTogSUZ3MjRNb2R1bGUsIGhhbmRsZXJSZWdpc3RyYXI6IChoYW5kbGVySW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHZvaWQpIHtcbiAgICAgICAgY29uc3QgYmFzZVBhdGggPSBtb2R1bGUuZ2V0QmFzZVBhdGgoKTtcblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwicmVnaXN0ZXJDb250cm9sbGVyc0Zyb21Nb2R1bGU6OjogYmFzZS1wYXRoOiBcIiArIGJhc2VQYXRoKTtcblxuICAgICAgICAvLyByZWxhdGl2ZSBwYXRoIGZyb20gdGhlIHBsYWNlIHdoZXJlIHRoZSBzY3JpcHQgaXMgZ2V0dGluZyBleGVjdXRlZCBpLmUgaW5kZXgudHMgaW4gYXBwLXJvb3RcbiAgICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcmVsYXRpdmUoJy4vJywgYmFzZVBhdGgpO1xuICAgICAgICBjb25zdCBjb250cm9sbGVyc1BhdGggPSByZXNvbHZlKHJlbGF0aXZlUGF0aCwgbW9kdWxlLmdldENvbnRyb2xsZXJzRGlyZWN0b3J5KCkpO1xuXG4gICAgICAgIC8vIFRPRE86IHN1cHBvcnQgZm9yIGNvbnRyb2xsZXIgcGF0aCBwcmVmaXggWyBlLmcuIG1vZHVsZS1uYW1lL2NvbnRyb2xsZXItcGF0aCBdXG5cbiAgICAgICAgLy8gbWFrZSBzdXJlIHRoYXQgdGhlIGNvbnRyb2xsZXIgcGF0aCBleGlzdHNcbiAgICAgICAgaWYgKGV4aXN0c1N5bmMoY29udHJvbGxlcnNQYXRoKSkge1xuXG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwicmVnaXN0ZXJDb250cm9sbGVyc0Zyb21Nb2R1bGU6OjogbW9kdWxlLWNvbnRyb2xsZXJzLXBhdGg6IFwiICsgY29udHJvbGxlcnNQYXRoKTtcblxuICAgICAgICAgICAgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMoY29udHJvbGxlcnNQYXRoLCBoYW5kbGVyUmVnaXN0cmFyKTtcblxuICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLndhcm4oXCJyZWdpc3RlckNvbnRyb2xsZXJzRnJvbU1vZHVsZTo6OiBtb2R1bGUtY29udHJvbGxlcnMtcGF0aCBkb2VzIG5vdCBleGlzdDogXCIgKyBjb250cm9sbGVyc1BhdGgpO1xuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICBzdGF0aWMgYXN5bmMgcmVnaXN0ZXJRdWV1ZXNGcm9tTW9kdWxlKG1vZHVsZTogSUZ3MjRNb2R1bGUsIGhhbmRsZXJSZWdpc3RyYXI6IChoYW5kbGVySW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHZvaWQpIHtcbiAgICAgICAgY29uc3QgYmFzZVBhdGggPSBtb2R1bGUuZ2V0QmFzZVBhdGgoKTtcblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwicmVnaXN0ZXJRdWV1ZXNGcm9tTW9kdWxlOjo6IGJhc2UtcGF0aDogXCIgKyBiYXNlUGF0aCk7XG5cbiAgICAgICAgLy8gcmVsYXRpdmUgcGF0aCBmcm9tIHRoZSBwbGFjZSB3aGVyZSB0aGUgc2NyaXB0IGlzIGdldHRpbmcgZXhlY3V0ZWQgaS5lIGluZGV4LnRzIGluIGFwcC1yb290XG4gICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHJlbGF0aXZlKCcuLycsIGJhc2VQYXRoKTtcbiAgICAgICAgY29uc3QgcXVldWVzUGF0aCA9IHJlc29sdmUocmVsYXRpdmVQYXRoLCBtb2R1bGUuZ2V0UXVldWVzRGlyZWN0b3J5KCkpO1xuICAgICAgICBjb25zdCBoYW5kbGVyc1BhdGggPSBtb2R1bGUuZ2V0UXVldWVGaWxlTmFtZXMoKTtcblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwicmVnaXN0ZXJRdWV1ZXNGcm9tTW9kdWxlOjo6IG1vZHVsZS1xdWV1ZXMtcGF0aDogXCIgKyBxdWV1ZXNQYXRoKTtcblxuICAgICAgICBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycyhxdWV1ZXNQYXRoLCBoYW5kbGVyUmVnaXN0cmFyLCBoYW5kbGVyc1BhdGgpO1xuICAgIH1cblxuICAgIHN0YXRpYyBhc3luYyByZWdpc3RlclRhc2tzRnJvbU1vZHVsZShtb2R1bGU6IElGdzI0TW9kdWxlLCBoYW5kbGVyUmVnaXN0cmFyOiAoaGFuZGxlckluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB2b2lkKSB7XG4gICAgICAgIGNvbnN0IGJhc2VQYXRoID0gbW9kdWxlLmdldEJhc2VQYXRoKCk7XG5cbiAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcInJlZ2lzdGVyVGFza3NGcm9tTW9kdWxlOjo6IGJhc2UtcGF0aDogXCIgKyBiYXNlUGF0aCk7XG5cbiAgICAgICAgLy8gcmVsYXRpdmUgcGF0aCBmcm9tIHRoZSBwbGFjZSB3aGVyZSB0aGUgc2NyaXB0IGlzIGdldHRpbmcgZXhlY3V0ZWQgaS5lIGluZGV4LnRzIGluIGFwcC1yb290XG4gICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHJlbGF0aXZlKCcuLycsIGJhc2VQYXRoKTtcbiAgICAgICAgY29uc3QgdGFza3NQYXRoID0gcmVzb2x2ZShyZWxhdGl2ZVBhdGgsIG1vZHVsZS5nZXRUYXNrc0RpcmVjdG9yeSgpKTtcbiAgICAgICAgY29uc3QgaGFuZGxlcnNQYXRoID0gbW9kdWxlLmdldFRhc2tGaWxlTmFtZXMoKTtcblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwicmVnaXN0ZXJUYXNrc0Zyb21Nb2R1bGU6OjogbW9kdWxlLXRhc2tzLXBhdGg6IFwiICsgdGFza3NQYXRoKTtcblxuICAgICAgICBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycyh0YXNrc1BhdGgsIGhhbmRsZXJSZWdpc3RyYXIsIGhhbmRsZXJzUGF0aCk7XG4gICAgfVxuXG4gICAgc3RhdGljIHNjYW5Db250cm9sbGVyU291cmNlRmlsZXNGcm9tKGRpcmVjdG9yeVBhdGg6IHN0cmluZykge1xuICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwiU2Nhbm5pbmcgVFMgc291cmNlIGZpbGVzIGZyb20gcGF0aDogXCIsIGRpcmVjdG9yeVBhdGgpO1xuICAgICAgICAvLyBSZXNvbHZlIHRoZSBhYnNvbHV0ZSBwYXRoXG4gICAgICAgIGNvbnN0IHNvdXJjZURpcmVjdG9yeSA9IHJlc29sdmUoZGlyZWN0b3J5UGF0aCk7XG4gICAgICAgIC8vIEdldCBhbGwgdGhlIGZpbGVzIGluIHRoZSBoYW5kbGVyIGRpcmVjdG9yeVxuICAgICAgICBjb25zdCBhbGxEaXJGaWxlcyA9IHJlYWRkaXJTeW5jKHNvdXJjZURpcmVjdG9yeSwgeyByZWN1cnNpdmU6IHRydWUgfSkgYXMgc3RyaW5nW107XG5cbiAgICAgICAgLy8gRmlsdGVyIHRoZSB0ZXN0IGZpbGVzIGFuZCBvbmx5IGluY2x1ZGUgdGhlIHNvdXJjZSBmaWxlc1xuICAgICAgICAvLyBXZSBhbHNvIGxvb2sgZm9yIEpTIGZpbGVzIGFzIHRoZSBGVzI0LW1vZHVsZXMgYXJlIGNvbXBpbGVkIHRvIEpTXG4gICAgICAgIGNvbnN0IHNvdXJjZUZpbGVQYXRocyA9IGFsbERpckZpbGVzLmZpbHRlcigoZmlsZSkgPT4ge1xuXG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgZmlsZS5lbmRzV2l0aChcIi5kLnRzXCIpIC8vIGlnbm9yZSBUeXBlU2NyaXB0IGRlY2xhcmF0aW9uIGZpbGVzXG4gICAgICAgICAgICAgICAgfHwgZmlsZS5lbmRzV2l0aChcIi50ZXN0LnRzXCIpIC8vIGlnbm9yZSB0ZXN0IGZpbGVzXG4gICAgICAgICAgICAgICAgfHwgZmlsZS5lbmRzV2l0aChcIi50ZXN0LmpzXCIpIC8vIGlnbm9yZSB0ZXN0IGZpbGVzXG4gICAgICAgICAgICAgICAgfHwgZmlsZS5lbmRzV2l0aChcIi5pbnRlZ3JhdGlvbi50ZXN0LnRzXCIpIC8vIGlnbm9yZSBpbnRlZ3JhdGlvbiB0ZXN0IGZpbGVzXG4gICAgICAgICAgICAgICAgfHwgZmlsZS5lbmRzV2l0aChcIi5pbnRlZ3JhdGlvbi50ZXN0LmpzXCIpIC8vIGlnbm9yZSBpbnRlZ3JhdGlvbiB0ZXN0IGZpbGVzXG4gICAgICAgICAgICAgICAgfHwgZmlsZS5lbmRzV2l0aChcIi5zcGVjLnRzXCIpIC8vIGlnbm9yZSBzcGVjIGZpbGVzXG4gICAgICAgICAgICAgICAgfHwgZmlsZS5lbmRzV2l0aChcIi5zcGVjLmpzXCIpIC8vIGlnbm9yZSBzcGVjIGZpbGVzXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBmaWxlLmVuZHNXaXRoKFwiLnRzXCIpIHx8IGZpbGUuZW5kc1dpdGgoXCIuanNcIik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBzb3VyY2VGaWxlUGF0aHM7XG4gICAgfVxuXG4gICAgc3RhdGljIGlzRmlmb1F1ZXVlUHJvcHMocHJvcHM6IFF1ZXVlUHJvcHMpIHtcbiAgICAgICAgaWYgKHByb3BzLmZpZm8pIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwcm9wcy5kZWR1cGxpY2F0aW9uU2NvcGUpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwcm9wcy5maWZvVGhyb3VnaHB1dExpbWl0KSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocHJvcHMuY29udGVudEJhc2VkRGVkdXBsaWNhdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHByb3BzLnF1ZXVlTmFtZSAmJiBpc1N0cmluZyhwcm9wcy5xdWV1ZU5hbWUpICYmIHByb3BzLnF1ZXVlTmFtZS5lbmRzV2l0aCgnLmZpZm8nKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogTG9hZCBhIHNpbmdsZSBoYW5kbGVyIGZpbGUgYW5kIGV4dHJhY3QgaXRzIGRlc2NyaXB0b3JzXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIHN0YXRpYyBhc3luYyBsb2FkSGFuZGxlckZpbGUoXG4gICAgICAgIGhhbmRsZXJQYXRoOiBzdHJpbmcsXG4gICAgICAgIGhhbmRsZXJEaXJlY3Rvcnk6IHN0cmluZ1xuICAgICk6IFByb21pc2U8SGFuZGxlckxvYWRSZXN1bHQ+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0OiBIYW5kbGVyTG9hZFJlc3VsdCA9IHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgaGFuZGxlclBhdGgsXG4gICAgICAgICAgICBkZXNjcmlwdG9yczogW11cbiAgICAgICAgfTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhgW1BhcmFsbGVsXSBMb2FkaW5nIGhhbmRsZXIgZmlsZTogJHtoYW5kbGVyUGF0aH1gKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRHluYW1pY2FsbHkgaW1wb3J0IHRoZSBjb250cm9sbGVyIGZpbGVcbiAgICAgICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gam9pbihoYW5kbGVyRGlyZWN0b3J5LCBoYW5kbGVyUGF0aCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIElmIGluIHNpbXVsYXRpb24gbW9kZSwgY2xlYXIgY2FjaGUgdG8gc3VwcG9ydCBITVJcbiAgICAgICAgICAgIGlmIChwcm9jZXNzLmVudi5TSU1VTEFUSU9OX01PREUgPT09ICd0cnVlJykge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSByZXF1aXJlLmNhY2hlW3JlcXVpcmUucmVzb2x2ZShmdWxsUGF0aCldO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHt9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IGF3YWl0IGltcG9ydChwcm9jZXNzLmVudi5TSU1VTEFUSU9OX01PREUgPT09ICd0cnVlJyA/IGBmaWxlOi8vJHtmdWxsUGF0aH0/dXBkYXRlPSR7RGF0ZS5ub3coKX1gIDogZnVsbFBhdGgpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDYWxjdWxhdGUgbW9kdWxlIGhhc2hcbiAgICAgICAgICAgIGNvbnN0IGZpbGVCdWZmZXIgPSByZWFkRmlsZVN5bmMoZnVsbFBhdGgpO1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlSGFzaCA9IGNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShmaWxlQnVmZmVyKS5kaWdlc3QoJ2hleCcpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKGBbUGFyYWxsZWxdIExvYWRlZCBtb2R1bGUgJHtoYW5kbGVyUGF0aH0sIGhhc2g6ICR7bW9kdWxlSGFzaH1gKTtcblxuICAgICAgICAgICAgLy8gRmluZCBhbmQgZXh0cmFjdCBoYW5kbGVyIGNsYXNzZXNcbiAgICAgICAgICAgIGZvciAoY29uc3QgZXhwb3J0ZWRJdGVtIG9mIE9iamVjdC52YWx1ZXMobW9kdWxlKSkge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgZXhwb3J0ZWRJdGVtID09PSBcImZ1bmN0aW9uXCIgJiYgZXhwb3J0ZWRJdGVtLm5hbWUgIT09IFwiaGFuZGxlclwiKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlc2NyaXB0b3I6IEhhbmRsZXJEZXNjcmlwdG9yID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFuZGxlckNsYXNzOiBleHBvcnRlZEl0ZW0sXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxlTmFtZTogaGFuZGxlclBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aDogaGFuZGxlckRpcmVjdG9yeSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbmRsZXJIYXNoOiBtb2R1bGVIYXNoXG4gICAgICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LmRlc2NyaXB0b3JzLnB1c2goZGVzY3JpcHRvcik7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoYFtQYXJhbGxlbF0gRm91bmQgaGFuZGxlciBjbGFzcyBpbiAke2hhbmRsZXJQYXRofTogJHtleHBvcnRlZEl0ZW0ubmFtZX1gKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7IC8vIE9ubHkgdGFrZSB0aGUgZmlyc3QgaGFuZGxlciBjbGFzcyBwZXIgZmlsZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmVzdWx0LnN1Y2Nlc3MgPSB0cnVlO1xuICAgICAgICAgICAgXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICByZXN1bHQuc3VjY2VzcyA9IGZhbHNlO1xuICAgICAgICAgICAgcmVzdWx0LmVycm9yID0gZXJyb3IgYXMgRXJyb3I7XG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmVycm9yKGBbUGFyYWxsZWxdIEZhaWxlZCB0byBsb2FkIGhhbmRsZXIgZmlsZTogJHtoYW5kbGVyUGF0aH1gLCBlcnJvcik7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVyIGhhbmRsZXJzIGZyb20gYSBkaXJlY3Rvcnkgd2l0aCBwYXJhbGxlbCBmaWxlIGxvYWRpbmdcbiAgICAgKiBGaWxlcyBhcmUgbG9hZGVkIGluIHBhcmFsbGVsIGZvciBzcGVlZCwgYnV0IGNvbnN0cnVjdCByZWdpc3RyYXRpb24gaXMgc2VxdWVudGlhbCBmb3IgQ0RLIHNhZmV0eVxuICAgICAqIFxuICAgICAqIEBwYXJhbSBwYXRoIC0gRGlyZWN0b3J5IHBhdGggY29udGFpbmluZyBoYW5kbGVyIGZpbGVzXG4gICAgICogQHBhcmFtIGhhbmRsZXJSZWdpc3RyYXIgLSBDYWxsYmFjayB0byByZWdpc3RlciBlYWNoIGhhbmRsZXJcbiAgICAgKiBAcGFyYW0gZmlsZXMgLSBPcHRpb25hbCBhcnJheSBvZiBzcGVjaWZpYyBmaWxlcyB0byBsb2FkIChpZiBlbXB0eSwgc2NhbnMgZGlyZWN0b3J5KVxuICAgICAqIEBwYXJhbSBjb25maWcgLSBDb25maWd1cmF0aW9uIGZvciBwYXJhbGxlbCBsb2FkaW5nXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiAvLyBVc2UgZGVmYXVsdCBjb25jdXJyZW5jeSAoNSlcbiAgICAgKiBhd2FpdCBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycygnLi9zcmMvY29udHJvbGxlcnMnLCByZWdpc3RlckNvbnRyb2xsZXIpO1xuICAgICAqIFxuICAgICAqIC8vIE92ZXJyaWRlIGNvbmN1cnJlbmN5IHZpYSBlbnZpcm9ubWVudCB2YXJpYWJsZSBGVzI0X0hBTkRMRVJfTE9BRF9DT05DVVJSRU5DWVxuICAgICAqIHByb2Nlc3MuZW52LkZXMjRfSEFORExFUl9MT0FEX0NPTkNVUlJFTkNZID0gJzEwJztcbiAgICAgKiBcbiAgICAgKiAvLyBPciBwYXNzIGNvbmZpZyBkaXJlY3RseVxuICAgICAqIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKCcuL3NyYy9jb250cm9sbGVycycsIHJlZ2lzdGVyQ29udHJvbGxlciwgW10sIHsgbWF4Q29uY3VycmVuY3k6IDUgfSk7XG4gICAgICovXG4gICAgc3RhdGljIGFzeW5jIHJlZ2lzdGVySGFuZGxlcnMoXG4gICAgICAgIHBhdGg6IHN0cmluZywgXG4gICAgICAgIGhhbmRsZXJSZWdpc3RyYXI6IChoYW5kbGVySW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+LCBcbiAgICAgICAgZmlsZXM6IHN0cmluZ1tdID0gW10sXG4gICAgICAgIGNvbmZpZzogUGFyYWxsZWxMb2FkQ29uZmlnID0ge31cbiAgICApIHtcbiAgICAgICAgLy8gVmFsaWRhdGUgaW5wdXRzXG4gICAgICAgIGlmICh0eXBlb2YgaGFuZGxlclJlZ2lzdHJhciAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdoYW5kbGVyUmVnaXN0cmFyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zdCBsb2FkVGltZXIgPSBUaW1lci5zdGFydCgpO1xuICAgICAgICBIZWxwZXIubG9nZ2VyLmluZm8oYFJlZ2lzdGVyaW5nIExhbWJkYSBIYW5kbGVycyBmcm9tOiAke3BhdGh9YCk7XG4gICAgICAgIFxuICAgICAgICAvLyBSZXNvbHZlIHRoZSBhYnNvbHV0ZSBwYXRoXG4gICAgICAgIGNvbnN0IGhhbmRsZXJEaXJlY3RvcnkgPSByZXNvbHZlKHBhdGgpO1xuXG4gICAgICAgIC8vIERldGVybWluZSB3aGljaCBmaWxlcyB0byBsb2FkXG4gICAgICAgIGxldCBoYW5kbGVyUGF0aHM6IHN0cmluZ1tdID0gW107XG4gICAgICAgIGlmIChmaWxlcy5sZW5ndGggIT09IDApIHtcbiAgICAgICAgICAgIGhhbmRsZXJQYXRocyA9IGZpbGVzO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRmlsdGVyIHRoZSBmaWxlcyB0byBvbmx5IGluY2x1ZGUgVHlwZVNjcmlwdCBmaWxlc1xuICAgICAgICAgICAgaGFuZGxlclBhdGhzID0gSGVscGVyLnNjYW5Db250cm9sbGVyU291cmNlRmlsZXNGcm9tKHBhdGgpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGhhbmRsZXJQYXRocy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIEhlbHBlci5sb2dnZXIud2FybihgTm8gaGFuZGxlciBmaWxlcyBmb3VuZCBpbjogJHtwYXRofWApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ29uY3VycmVuY3kgY29uZmlndXJhdGlvblxuICAgICAgICAvLyBEZWZhdWx0OiA1IChjb25zZXJ2YXRpdmUsIGF2b2lkcyBtb2R1bGUgcmVzb2x1dGlvbiBjb250ZW50aW9uIGZvciBsYXJnZSBmaWxlcyBsaWtlIGRpLnRzKVxuICAgICAgICAvLyBPdmVycmlkZSB2aWEgY29uZmlnLm1heENvbmN1cnJlbmN5IG9yIGVudiB2YXIgRlcyNF9IQU5ETEVSX0xPQURfQ09OQ1VSUkVOQ1lcbiAgICAgICAgbGV0IGVudkNvbmN1cnJlbmN5OiBudW1iZXIgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChwcm9jZXNzLmVudi5GVzI0X0hBTkRMRVJfTE9BRF9DT05DVVJSRU5DWSkge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VJbnQocHJvY2Vzcy5lbnYuRlcyNF9IQU5ETEVSX0xPQURfQ09OQ1VSUkVOQ1ksIDEwKTtcbiAgICAgICAgICAgIGlmICghaXNOYU4ocGFyc2VkKSAmJiBwYXJzZWQgPiAwKSB7XG4gICAgICAgICAgICAgICAgZW52Q29uY3VycmVuY3kgPSBwYXJzZWQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIEhlbHBlci5sb2dnZXIud2FybihcbiAgICAgICAgICAgICAgICAgICAgYEludmFsaWQgRlcyNF9IQU5ETEVSX0xPQURfQ09OQ1VSUkVOQ1k6IFwiJHtwcm9jZXNzLmVudi5GVzI0X0hBTkRMRVJfTE9BRF9DT05DVVJSRU5DWX1cIi4gVXNpbmcgZGVmYXVsdC5gXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29uc3QgbWF4Q29uY3VycmVuY3kgPSBjb25maWcubWF4Q29uY3VycmVuY3kgPz8gZW52Q29uY3VycmVuY3kgPz8gNTtcbiAgICAgICAgY29uc3QgZmFpbEZhc3QgPSBjb25maWcuZmFpbEZhc3QgPz8gZmFsc2U7XG5cbiAgICAgICAgLy8gQ2xhbXAgdG8gc2FmZSByYW5nZVxuICAgICAgICBjb25zdCBzYWZlQ29uY3VycmVuY3kgPSBNYXRoLm1heCgxLCBNYXRoLm1pbig1MCwgbWF4Q29uY3VycmVuY3kpKTtcbiAgICAgICAgXG4gICAgICAgIGlmIChzYWZlQ29uY3VycmVuY3kgIT09IG1heENvbmN1cnJlbmN5KSB7XG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLndhcm4oYENvbmN1cnJlbmN5ICR7bWF4Q29uY3VycmVuY3l9IGNsYW1wZWQgdG8gJHtzYWZlQ29uY3VycmVuY3l9ICh2YWxpZCByYW5nZTogMS01MClgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRvdGFsQ2h1bmtzID0gTWF0aC5jZWlsKGhhbmRsZXJQYXRocy5sZW5ndGggLyBzYWZlQ29uY3VycmVuY3kpO1xuICAgICAgICBIZWxwZXIubG9nZ2VyLmluZm8oXG4gICAgICAgICAgICBg8J+TpiBMb2FkaW5nICR7aGFuZGxlclBhdGhzLmxlbmd0aH0gaGFuZGxlciBmaWxlKHMpIGAgK1xuICAgICAgICAgICAgYFtjb25jdXJyZW5jeTogJHtzYWZlQ29uY3VycmVuY3l9LCBjaHVua3M6ICR7dG90YWxDaHVua3N9XS4uLmBcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBQSEFTRSAxOiBMb2FkIGFsbCBmaWxlcyBpbiBwYXJhbGxlbCAod2l0aCBjb25jdXJyZW5jeSBsaW1pdClcbiAgICAgICAgY29uc3QgbG9hZFJlc3VsdHM6IEhhbmRsZXJMb2FkUmVzdWx0W10gPSBbXTtcbiAgICAgICAgY29uc3QgZXJyb3JzOiBBcnJheTx7IGZpbGU6IHN0cmluZzsgZXJyb3I6IEVycm9yIH0+ID0gW107XG4gICAgICAgIFxuICAgICAgICAvLyBQcm9jZXNzIGZpbGVzIGluIGNodW5rcyB0byBsaW1pdCBjb25jdXJyZW5jeVxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGhhbmRsZXJQYXRocy5sZW5ndGg7IGkgKz0gc2FmZUNvbmN1cnJlbmN5KSB7XG4gICAgICAgICAgICBjb25zdCBjaHVuayA9IGhhbmRsZXJQYXRocy5zbGljZShpLCBpICsgc2FmZUNvbmN1cnJlbmN5KTtcbiAgICAgICAgICAgIGNvbnN0IGNodW5rTnVtID0gTWF0aC5mbG9vcihpIC8gc2FmZUNvbmN1cnJlbmN5KSArIDE7XG4gICAgICAgICAgICBjb25zdCBjaHVua1N0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFNob3cgd2hpY2ggZmlsZXMgd2UncmUgbG9hZGluZyBpbiB0aGlzIGNodW5rXG4gICAgICAgICAgICBjb25zdCBjaHVua0ZpbGVOYW1lcyA9IGNodW5rLm1hcChwID0+IHBhdGhCYXNlbmFtZShwLCAnLnRzJykpLmpvaW4oJywgJyk7XG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmluZm8oXG4gICAgICAgICAgICAgICAgYCAgIFske2NodW5rTnVtfS8ke3RvdGFsQ2h1bmtzfV0gTG9hZGluZzogJHtjaHVua0ZpbGVOYW1lc31gXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBjb25zdCBjaHVua1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgICAgICAgICBjaHVuay5tYXAoaGFuZGxlclBhdGggPT4gXG4gICAgICAgICAgICAgICAgICAgIEhlbHBlci5sb2FkSGFuZGxlckZpbGUoaGFuZGxlclBhdGgsIGhhbmRsZXJEaXJlY3RvcnkpXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgbG9hZFJlc3VsdHMucHVzaCguLi5jaHVua1Jlc3VsdHMpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBTaG93IGNodW5rIGNvbXBsZXRpb24gd2l0aCB0aW1pbmdcbiAgICAgICAgICAgIGNvbnN0IGNodW5rVGltZU1zID0gRGF0ZS5ub3coKSAtIGNodW5rU3RhcnRUaW1lO1xuICAgICAgICAgICAgY29uc3QgbG9hZGVkU29GYXIgPSBsb2FkUmVzdWx0cy5sZW5ndGg7XG4gICAgICAgICAgICBjb25zdCBjaHVua0Rlc2NyaXB0b3JzID0gY2h1bmtSZXN1bHRzLnJlZHVjZSgoc3VtLCByKSA9PiBzdW0gKyByLmRlc2NyaXB0b3JzLmxlbmd0aCwgMCk7XG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmluZm8oXG4gICAgICAgICAgICAgICAgYCAgIFske2NodW5rTnVtfS8ke3RvdGFsQ2h1bmtzfV0g4pyTIExvYWRlZCAke2xvYWRlZFNvRmFyfS8ke2hhbmRsZXJQYXRocy5sZW5ndGh9IGAgK1xuICAgICAgICAgICAgICAgIGAoKyR7Y2h1bmtEZXNjcmlwdG9yc30gaGFuZGxlciR7Y2h1bmtEZXNjcmlwdG9ycyAhPT0gMSA/ICdzJyA6ICcnfSkgaW4gJHtjaHVua1RpbWVNc31tc2BcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGZvciBlcnJvcnMgaW4gdGhpcyBjaHVua1xuICAgICAgICAgICAgY29uc3QgY2h1bmtFcnJvcnMgPSBjaHVua1Jlc3VsdHMuZmlsdGVyKHIgPT4gIXIuc3VjY2Vzcyk7XG4gICAgICAgICAgICBpZiAoY2h1bmtFcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIGNodW5rRXJyb3JzLmZvckVhY2gociA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChyLmVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvcnMucHVzaCh7IGZpbGU6IHIuaGFuZGxlclBhdGgsIGVycm9yOiByLmVycm9yIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5lcnJvcihgICAg4p2MIEZhaWxlZCB0byBsb2FkICR7cGF0aEJhc2VuYW1lKHIuaGFuZGxlclBhdGgpfTogJHtyLmVycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGlmIChmYWlsRmFzdCkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmVycm9yKGAgICDinYwgRmFpbC1mYXN0IGVuYWJsZWQsIHN0b3BwaW5nIGFmdGVyICR7ZXJyb3JzLmxlbmd0aH0gZXJyb3IocylgKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbG9hZFRpbWVNcyA9IGxvYWRUaW1lci5lbGFwc2VkKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBSZXBvcnQgbG9hZGluZyByZXN1bHRzXG4gICAgICAgIGNvbnN0IHN1Y2Nlc3NDb3VudCA9IGxvYWRSZXN1bHRzLmZpbHRlcihyID0+IHIuc3VjY2VzcykubGVuZ3RoO1xuICAgICAgICBjb25zdCBmYWlsQ291bnQgPSBlcnJvcnMubGVuZ3RoO1xuICAgICAgICBjb25zdCB0b3RhbERlc2NyaXB0b3JzID0gbG9hZFJlc3VsdHMucmVkdWNlKChzdW0sIHIpID0+IHN1bSArIHIuZGVzY3JpcHRvcnMubGVuZ3RoLCAwKTtcblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmluZm8oXG4gICAgICAgICAgICBg4pyTIExvYWRlZCAke3N1Y2Nlc3NDb3VudH0vJHtoYW5kbGVyUGF0aHMubGVuZ3RofSBmaWxlcyBpbiAke2xvYWRUaW1lTXMudG9GaXhlZCgwKX1tcyBgICtcbiAgICAgICAgICAgIGAoJHt0b3RhbERlc2NyaXB0b3JzfSBoYW5kbGVycyBmb3VuZCR7ZmFpbENvdW50ID4gMCA/IGAsICR7ZmFpbENvdW50fSBmYWlsZWRgIDogJyd9KWBcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBGYWlsIGlmIHdlIGhhdmUgZXJyb3JzXG4gICAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5lcnJvcihg4p2MIEZhaWxlZCB0byBsb2FkICR7ZXJyb3JzLmxlbmd0aH0gaGFuZGxlciBmaWxlKHMpOmApO1xuICAgICAgICAgICAgZXJyb3JzLmZvckVhY2goKHsgZmlsZSwgZXJyb3IgfSkgPT4ge1xuICAgICAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZXJyb3IoYCAgLSAke2ZpbGV9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgICBgRmFpbGVkIHRvIGxvYWQgJHtlcnJvcnMubGVuZ3RofSBoYW5kbGVyIGZpbGUocykuIEZpcnN0IGVycm9yOiAke2Vycm9yc1swXS5lcnJvci5tZXNzYWdlfWBcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQSEFTRSAyOiBSZWdpc3RlciBoYW5kbGVycyB3aXRoIENES1xuICAgICAgICAvLyBOb3RlOiBKYXZhU2NyaXB0IGlzIHNpbmdsZS10aHJlYWRlZCwgc28gZXZlbiBcInBhcmFsbGVsXCIgcmVnaXN0cmF0aW9uIGlzIHNlcmlhbGl6ZWQgYnkgZXZlbnQgbG9vcFxuICAgICAgICAvLyBCdXQgd2Uga2VlcCBpdCBzZXF1ZW50aWFsIHRvIGJlIHNhZmUgd2l0aCBDREsvRncyNCBpbnRlcm5hbCBzdGF0ZSBtYW5hZ2VtZW50XG4gICAgICAgIGNvbnN0IHJlZ2lzdGVyVGltZXIgPSBUaW1lci5zdGFydCgpO1xuICAgICAgICBIZWxwZXIubG9nZ2VyLmluZm8oYPCflKcgUmVnaXN0ZXJpbmcgJHt0b3RhbERlc2NyaXB0b3JzfSBoYW5kbGVyKHMpIHdpdGggQ0RLLi4uYCk7XG5cbiAgICAgICAgbGV0IHJlZ2lzdGVyZWRDb3VudCA9IDA7XG4gICAgICAgIGNvbnN0IHJlZ2lzdHJhdGlvbkVycm9yczogQXJyYXk8eyBkZXNjcmlwdG9yOiBIYW5kbGVyRGVzY3JpcHRvcjsgZXJyb3I6IEVycm9yIH0+ID0gW107XG4gICAgICAgIGxldCBsYXN0UHJvZ3Jlc3NMb2cgPSBEYXRlLm5vdygpO1xuICAgICAgICBjb25zdCBwcm9ncmVzc0ludGVydmFsTXMgPSAyMDAwOyAvLyBMb2cgcHJvZ3Jlc3MgZXZlcnkgMiBzZWNvbmRzXG5cbiAgICAgICAgZm9yIChjb25zdCByZXN1bHQgb2YgbG9hZFJlc3VsdHMpIHtcbiAgICAgICAgICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGRlc2NyaXB0b3Igb2YgcmVzdWx0LmRlc2NyaXB0b3JzKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcbiAgICAgICAgICAgICAgICAgICAgICAgIGBSZWdpc3RlcmluZyAke2Rlc2NyaXB0b3IuaGFuZGxlckNsYXNzLm5hbWV9IGZyb20gJHtkZXNjcmlwdG9yLmZpbGVOYW1lfWBcbiAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGhhbmRsZXJSZWdpc3RyYXIoZGVzY3JpcHRvcik7XG4gICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyZWRDb3VudCsrO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gU2hvdyBwcm9ncmVzcyBwZXJpb2RpY2FsbHkgZm9yIGxvbmctcnVubmluZyByZWdpc3RyYXRpb25zXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChub3cgLSBsYXN0UHJvZ3Jlc3NMb2cgPiBwcm9ncmVzc0ludGVydmFsTXMgJiYgcmVnaXN0ZXJlZENvdW50IDwgdG90YWxEZXNjcmlwdG9ycykge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZWxhcHNlZE1zID0gcmVnaXN0ZXJUaW1lci5lbGFwc2VkKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhdmdNcyA9IGVsYXBzZWRNcyAvIHJlZ2lzdGVyZWRDb3VudDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlbWFpbmluZ0NvdW50ID0gdG90YWxEZXNjcmlwdG9ycyAtIHJlZ2lzdGVyZWRDb3VudDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVzdGltYXRlZFJlbWFpbmluZ01zID0gTWF0aC5yb3VuZChhdmdNcyAqIHJlbWFpbmluZ0NvdW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuaW5mbyhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAg4o+zIFByb2dyZXNzOiAke3JlZ2lzdGVyZWRDb3VudH0vJHt0b3RhbERlc2NyaXB0b3JzfSByZWdpc3RlcmVkIGAgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAofiR7TWF0aC5yb3VuZChlc3RpbWF0ZWRSZW1haW5pbmdNcyAvIDEwMDApfXMgcmVtYWluaW5nKWBcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0UHJvZ3Jlc3NMb2cgPSBub3c7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXJyID0gZXJyb3IgYXMgRXJyb3I7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZXJyb3IoXG4gICAgICAgICAgICAgICAgICAgICAgICBgRmFpbGVkIHRvIHJlZ2lzdGVyIGhhbmRsZXIgJHtkZXNjcmlwdG9yLmhhbmRsZXJDbGFzcy5uYW1lfSBmcm9tICR7ZGVzY3JpcHRvci5maWxlTmFtZX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JcbiAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgcmVnaXN0cmF0aW9uRXJyb3JzLnB1c2goeyBkZXNjcmlwdG9yLCBlcnJvcjogZXJyIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChmYWlsRmFzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBGYWlsZWQgdG8gcmVnaXN0ZXIgaGFuZGxlciAke2Rlc2NyaXB0b3IuaGFuZGxlckNsYXNzLm5hbWV9OiAke2Vyci5tZXNzYWdlfWBcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZWdpc3RlclRpbWVNcyA9IHJlZ2lzdGVyVGltZXIuZWxhcHNlZCgpO1xuXG4gICAgICAgIC8vIEZpbmFsIHJlcG9ydFxuICAgICAgICBpZiAocmVnaXN0cmF0aW9uRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZXJyb3IoXG4gICAgICAgICAgICAgICAgYOKdjCBGYWlsZWQgdG8gcmVnaXN0ZXIgJHtyZWdpc3RyYXRpb25FcnJvcnMubGVuZ3RofSBoYW5kbGVyKHMpOmBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICByZWdpc3RyYXRpb25FcnJvcnMuZm9yRWFjaCgoeyBkZXNjcmlwdG9yLCBlcnJvciB9KSA9PiB7XG4gICAgICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5lcnJvcihgICAtICR7ZGVzY3JpcHRvci5oYW5kbGVyQ2xhc3MubmFtZX06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgIGBGYWlsZWQgdG8gcmVnaXN0ZXIgJHtyZWdpc3RyYXRpb25FcnJvcnMubGVuZ3RofSBoYW5kbGVyKHMpLiBgICtcbiAgICAgICAgICAgICAgICBgRmlyc3QgZXJyb3I6ICR7cmVnaXN0cmF0aW9uRXJyb3JzWzBdLmVycm9yLm1lc3NhZ2V9YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRvdGFsVGltZU1zID0gbG9hZFRpbWVNcyArIHJlZ2lzdGVyVGltZU1zO1xuICAgICAgICBjb25zdCB0b3RhbFRpbWVTZWMgPSAodG90YWxUaW1lTXMgLyAxMDAwKS50b0ZpeGVkKDEpO1xuICAgICAgICBIZWxwZXIubG9nZ2VyLmluZm8oXG4gICAgICAgICAgICBg4pyFIFN1Y2Nlc3NmdWxseSByZWdpc3RlcmVkICR7cmVnaXN0ZXJlZENvdW50fSBoYW5kbGVyKHMpXFxuYCArXG4gICAgICAgICAgICBgICAg8J+TiiBMb2FkIHRpbWU6ICR7KGxvYWRUaW1lTXMgLyAxMDAwKS50b0ZpeGVkKDEpfXMgfCBgICtcbiAgICAgICAgICAgIGBSZWdpc3RlciB0aW1lOiAkeyhyZWdpc3RlclRpbWVNcyAvIDEwMDApLnRvRml4ZWQoMSl9cyB8IGAgK1xuICAgICAgICAgICAgYFRvdGFsOiAke3RvdGFsVGltZVNlY31zYCArXG4gICAgICAgICAgICBgJHtoYW5kbGVyUGF0aHMubGVuZ3RoID4gMSA/IGAgKCR7KHRvdGFsVGltZU1zIC8gaGFuZGxlclBhdGhzLmxlbmd0aCkudG9GaXhlZCgwKX1tcyBwZXIgZmlsZSlgIDogJyd9YFxuICAgICAgICApO1xuICAgIH1cbn0iXX0=