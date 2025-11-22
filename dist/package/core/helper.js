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
            const moduleHash = (0, crypto_1.createHash)('md5').update(JSON.stringify(fileBuffer)).digest('hex');
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
     * // Use default concurrency (10)
     * await Helper.registerHandlers('./src/controllers', registerController);
     *
     * // Override concurrency via environment variable FW24_HANDLER_LOAD_CONCURRENCY
     * process.env.FW24_HANDLER_LOAD_CONCURRENCY = '20';
     *
     * // Or pass config directly
     * await Helper.registerHandlers('./src/controllers', registerController, [], { maxConcurrency: 20 });
     */
    static async registerHandlers(path, handlerRegistrar, files = [], config = {}) {
        // Allow environment variable to override concurrency
        const envConcurrency = process.env.FW24_HANDLER_LOAD_CONCURRENCY
            ? parseInt(process.env.FW24_HANDLER_LOAD_CONCURRENCY, 10)
            : undefined;
        const maxConcurrency = config.maxConcurrency ?? envConcurrency ?? 10;
        const failFast = config.failFast ?? false;
        // Safety check
        if (maxConcurrency < 1 || maxConcurrency > 50) {
            Helper.logger.warn(`Invalid maxConcurrency: ${maxConcurrency}. Using safe default of 10. ` +
                `Valid range: 1-50`);
        }
        const safeConcurrency = Math.max(1, Math.min(50, maxConcurrency));
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
        Helper.logger.info(`📦 Loading ${handlerPaths.length} handler files in parallel (concurrency: ${safeConcurrency})...`);
        // PHASE 1: Load all files in parallel (with concurrency limit)
        const loadResults = [];
        const errors = [];
        // Process files in chunks to limit concurrency
        for (let i = 0; i < handlerPaths.length; i += safeConcurrency) {
            const chunk = handlerPaths.slice(i, i + safeConcurrency);
            const chunkNum = Math.floor(i / safeConcurrency) + 1;
            const totalChunks = Math.ceil(handlerPaths.length / safeConcurrency);
            Helper.logger.debug(`[Parallel] Loading chunk ${chunkNum}/${totalChunks} (${chunk.length} files)`);
            const chunkResults = await Promise.all(chunk.map(handlerPath => Helper.loadHandlerFile(handlerPath, handlerDirectory)));
            loadResults.push(...chunkResults);
            // Check for errors in this chunk
            const chunkErrors = chunkResults.filter(r => !r.success);
            if (chunkErrors.length > 0) {
                chunkErrors.forEach(r => {
                    if (r.error) {
                        errors.push({ file: r.handlerPath, error: r.error });
                    }
                });
                if (failFast) {
                    Helper.logger.error(`[Parallel] ❌ Fail-fast enabled, stopping after ${errors.length} error(s)`);
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
        // PHASE 2: Register handlers sequentially (CDK is not thread-safe)
        const registerTimer = Timer.start();
        Helper.logger.info(`🔧 Registering ${totalDescriptors} handler(s) sequentially...`);
        let registeredCount = 0;
        const registrationErrors = [];
        for (const result of loadResults) {
            if (!result.success)
                continue;
            for (const descriptor of result.descriptors) {
                try {
                    Helper.logger.debug(`[Sequential] Registering handler from ${descriptor.fileName}: ${descriptor.handlerClass.name}`);
                    await handlerRegistrar(descriptor);
                    registeredCount++;
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
        Helper.logger.info(`✅ Successfully registered ${registeredCount} handler(s) in ${registerTimeMs.toFixed(0)}ms ` +
            `(Total: ${(loadTimeMs + registerTimeMs).toFixed(0)}ms, ` +
            `${((loadTimeMs + registerTimeMs) / handlerPaths.length).toFixed(0)}ms per file)`);
    }
}
exports.Helper = Helper;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGVscGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvcmUvaGVscGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDJCQUErRTtBQUMvRSwrQkFBZ0Q7QUFHaEQsd0NBQXVEO0FBRXZELG9DQUFvQztBQUNwQyxtQ0FBb0M7QUE2QnBDOztHQUVHO0FBQ0gsTUFBTSxLQUFLO0lBQ0MsU0FBUyxDQUFTO0lBRTFCO1FBQ0ksSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDaEMsQ0FBQztJQUVELE9BQU87UUFDSCxPQUFPLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDO0lBQ3ZDLENBQUM7SUFFRCxNQUFNLENBQUMsS0FBSztRQUNSLE9BQU8sSUFBSSxLQUFLLEVBQUUsQ0FBQztJQUN2QixDQUFDO0NBQ0o7QUFJRCxNQUFhLE1BQU07SUFFZixNQUFNLENBQVUsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7SUFFbkQsTUFBTSxDQUFDLGFBQWEsQ0FBSSxNQUFTLEVBQUUsTUFBTSxHQUFHLEtBQUs7UUFDN0MsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDO2FBQ25CLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUM7YUFDckMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFO1lBQ1gsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLE1BQU0sQ0FBQyxHQUFHLEdBQUcsTUFBTSxHQUFHLEdBQUcsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLEVBQUUs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YyxDQUNsRSxDQUFDO1lBQ0Ysa0JBQWtCLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRTtnQkFDakQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxVQUFVLENBQUMsWUFBWSxDQUFDLElBQUksS0FBSyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQztZQUNqRixDQUFDLENBQUMsQ0FBQztZQUNILE1BQU0sSUFBSSxLQUFLLENBQ1gsc0JBQXNCLGtCQUFrQixDQUFDLE1BQU0sZUFBZTtnQkFDOUQsZ0JBQWdCLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FDeEQsQ0FBQztRQUNOLENBQUM7UUFFRCxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FDZCw2QkFBNkIsZUFBZSxrQkFBa0IsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsS0FBSztZQUM1RixXQUFXLENBQUMsVUFBVSxHQUFHLGNBQWMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTTtZQUN6RCxHQUFHLENBQUMsQ0FBQyxVQUFVLEdBQUcsY0FBYyxDQUFDLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUNwRixDQUFDO0lBQ04sQ0FBQzs7QUFsV0wsd0JBbVdDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcmVhZGRpclN5bmMsIGV4aXN0c1N5bmMsIHJlYWRGaWxlLCByZWFkRmlsZVN5bmMsIHN0YXRTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyByZXNvbHZlLCBqb2luLCByZWxhdGl2ZSwgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IEhhbmRsZXJEZXNjcmlwdG9yIGZyb20gXCIuLi9pbnRlcmZhY2VzL2hhbmRsZXItZGVzY3JpcHRvclwiO1xuaW1wb3J0IHsgSUZ3MjRNb2R1bGUgfSBmcm9tIFwiLi9ydW50aW1lL21vZHVsZVwiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyLCBMb2dEdXJhdGlvbiB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBRdWV1ZVByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IGlzU3RyaW5nIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSBcImNyeXB0b1wiO1xuXG4vKipcbiAqIFJlc3VsdCBvZiBsb2FkaW5nIGEgc2luZ2xlIGhhbmRsZXIgZmlsZVxuICovXG5pbnRlcmZhY2UgSGFuZGxlckxvYWRSZXN1bHQge1xuICAgIHN1Y2Nlc3M6IGJvb2xlYW47XG4gICAgaGFuZGxlclBhdGg6IHN0cmluZztcbiAgICBkZXNjcmlwdG9yczogSGFuZGxlckRlc2NyaXB0b3JbXTtcbiAgICBlcnJvcj86IEVycm9yO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIHBhcmFsbGVsIGhhbmRsZXIgbG9hZGluZ1xuICovXG5pbnRlcmZhY2UgUGFyYWxsZWxMb2FkQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBNYXhpbXVtIG51bWJlciBvZiBmaWxlcyB0byBsb2FkIGluIHBhcmFsbGVsXG4gICAgICogQGRlZmF1bHQgMTBcbiAgICAgKi9cbiAgICBtYXhDb25jdXJyZW5jeT86IG51bWJlcjtcbiAgICBcbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIHRvIGZhaWwgZmFzdCBvbiBmaXJzdCBlcnJvciBvciBjb2xsZWN0IGFsbCBlcnJvcnNcbiAgICAgKiBAZGVmYXVsdCBmYWxzZSAoY29sbGVjdCBhbGwgZXJyb3JzKVxuICAgICAqL1xuICAgIGZhaWxGYXN0PzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBTaW1wbGUgdGltZXIgdXRpbGl0eSBmb3IgbWVhc3VyaW5nIGR1cmF0aW9uc1xuICovXG5jbGFzcyBUaW1lciB7XG4gICAgcHJpdmF0ZSBzdGFydFRpbWU6IG51bWJlcjtcblxuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICB0aGlzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgfVxuXG4gICAgZWxhcHNlZCgpOiBudW1iZXIge1xuICAgICAgICByZXR1cm4gRGF0ZS5ub3coKSAtIHRoaXMuc3RhcnRUaW1lO1xuICAgIH1cblxuICAgIHN0YXRpYyBzdGFydCgpOiBUaW1lciB7XG4gICAgICAgIHJldHVybiBuZXcgVGltZXIoKTtcbiAgICB9XG59XG5cblxuXG5leHBvcnQgY2xhc3MgSGVscGVyIHtcblxuICAgIHN0YXRpYyByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoSGVscGVyLm5hbWUpO1xuXG4gICAgc3RhdGljIGh5ZHJhdGVDb25maWc8VD4oY29uZmlnOiBULCBwcmVmaXggPSBcIkFQUFwiKSB7XG4gICAgICAgIE9iamVjdC5rZXlzKHByb2Nlc3MuZW52KVxuICAgICAgICAgICAgLmZpbHRlcihrZXkgPT4ga2V5LnN0YXJ0c1dpdGgocHJlZml4KSlcbiAgICAgICAgICAgIC5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbmV3S2V5ID0ga2V5LnJlcGxhY2UobmV3IFJlZ0V4cCgnXicgKyBwcmVmaXggKyAnXycpLCAnJykudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9fLi9nLCB4ID0+IHhbIDEgXS50b1VwcGVyQ2FzZSgpKTtcbiAgICAgICAgICAgICAgICBpZiAoKGNvbmZpZyBhcyBhbnkpWyBuZXdLZXkgXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIChjb25maWcgYXMgYW55KVsgbmV3S2V5IF0gPSBwcm9jZXNzLmVudlsga2V5IF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgc3RhdGljIGFzeW5jIHJlZ2lzdGVyQ29udHJvbGxlcnNGcm9tTW9kdWxlKG1vZHVsZTogSUZ3MjRNb2R1bGUsIGhhbmRsZXJSZWdpc3RyYXI6IChoYW5kbGVySW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHZvaWQpIHtcbiAgICAgICAgY29uc3QgYmFzZVBhdGggPSBtb2R1bGUuZ2V0QmFzZVBhdGgoKTtcblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwicmVnaXN0ZXJDb250cm9sbGVyc0Zyb21Nb2R1bGU6OjogYmFzZS1wYXRoOiBcIiArIGJhc2VQYXRoKTtcblxuICAgICAgICAvLyByZWxhdGl2ZSBwYXRoIGZyb20gdGhlIHBsYWNlIHdoZXJlIHRoZSBzY3JpcHQgaXMgZ2V0dGluZyBleGVjdXRlZCBpLmUgaW5kZXgudHMgaW4gYXBwLXJvb3RcbiAgICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcmVsYXRpdmUoJy4vJywgYmFzZVBhdGgpO1xuICAgICAgICBjb25zdCBjb250cm9sbGVyc1BhdGggPSByZXNvbHZlKHJlbGF0aXZlUGF0aCwgbW9kdWxlLmdldENvbnRyb2xsZXJzRGlyZWN0b3J5KCkpO1xuXG4gICAgICAgIC8vIFRPRE86IHN1cHBvcnQgZm9yIGNvbnRyb2xsZXIgcGF0aCBwcmVmaXggWyBlLmcuIG1vZHVsZS1uYW1lL2NvbnRyb2xsZXItcGF0aCBdXG5cbiAgICAgICAgLy8gbWFrZSBzdXJlIHRoYXQgdGhlIGNvbnRyb2xsZXIgcGF0aCBleGlzdHNcbiAgICAgICAgaWYgKGV4aXN0c1N5bmMoY29udHJvbGxlcnNQYXRoKSkge1xuXG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwicmVnaXN0ZXJDb250cm9sbGVyc0Zyb21Nb2R1bGU6OjogbW9kdWxlLWNvbnRyb2xsZXJzLXBhdGg6IFwiICsgY29udHJvbGxlcnNQYXRoKTtcblxuICAgICAgICAgICAgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMoY29udHJvbGxlcnNQYXRoLCBoYW5kbGVyUmVnaXN0cmFyKTtcblxuICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLndhcm4oXCJyZWdpc3RlckNvbnRyb2xsZXJzRnJvbU1vZHVsZTo6OiBtb2R1bGUtY29udHJvbGxlcnMtcGF0aCBkb2VzIG5vdCBleGlzdDogXCIgKyBjb250cm9sbGVyc1BhdGgpO1xuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICBzdGF0aWMgYXN5bmMgcmVnaXN0ZXJRdWV1ZXNGcm9tTW9kdWxlKG1vZHVsZTogSUZ3MjRNb2R1bGUsIGhhbmRsZXJSZWdpc3RyYXI6IChoYW5kbGVySW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHZvaWQpIHtcbiAgICAgICAgY29uc3QgYmFzZVBhdGggPSBtb2R1bGUuZ2V0QmFzZVBhdGgoKTtcblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwicmVnaXN0ZXJRdWV1ZXNGcm9tTW9kdWxlOjo6IGJhc2UtcGF0aDogXCIgKyBiYXNlUGF0aCk7XG5cbiAgICAgICAgLy8gcmVsYXRpdmUgcGF0aCBmcm9tIHRoZSBwbGFjZSB3aGVyZSB0aGUgc2NyaXB0IGlzIGdldHRpbmcgZXhlY3V0ZWQgaS5lIGluZGV4LnRzIGluIGFwcC1yb290XG4gICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHJlbGF0aXZlKCcuLycsIGJhc2VQYXRoKTtcbiAgICAgICAgY29uc3QgcXVldWVzUGF0aCA9IHJlc29sdmUocmVsYXRpdmVQYXRoLCBtb2R1bGUuZ2V0UXVldWVzRGlyZWN0b3J5KCkpO1xuICAgICAgICBjb25zdCBoYW5kbGVyc1BhdGggPSBtb2R1bGUuZ2V0UXVldWVGaWxlTmFtZXMoKTtcblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwicmVnaXN0ZXJRdWV1ZXNGcm9tTW9kdWxlOjo6IG1vZHVsZS1xdWV1ZXMtcGF0aDogXCIgKyBxdWV1ZXNQYXRoKTtcblxuICAgICAgICBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycyhxdWV1ZXNQYXRoLCBoYW5kbGVyUmVnaXN0cmFyLCBoYW5kbGVyc1BhdGgpO1xuICAgIH1cblxuICAgIHN0YXRpYyBhc3luYyByZWdpc3RlclRhc2tzRnJvbU1vZHVsZShtb2R1bGU6IElGdzI0TW9kdWxlLCBoYW5kbGVyUmVnaXN0cmFyOiAoaGFuZGxlckluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB2b2lkKSB7XG4gICAgICAgIGNvbnN0IGJhc2VQYXRoID0gbW9kdWxlLmdldEJhc2VQYXRoKCk7XG5cbiAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcInJlZ2lzdGVyVGFza3NGcm9tTW9kdWxlOjo6IGJhc2UtcGF0aDogXCIgKyBiYXNlUGF0aCk7XG5cbiAgICAgICAgLy8gcmVsYXRpdmUgcGF0aCBmcm9tIHRoZSBwbGFjZSB3aGVyZSB0aGUgc2NyaXB0IGlzIGdldHRpbmcgZXhlY3V0ZWQgaS5lIGluZGV4LnRzIGluIGFwcC1yb290XG4gICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHJlbGF0aXZlKCcuLycsIGJhc2VQYXRoKTtcbiAgICAgICAgY29uc3QgdGFza3NQYXRoID0gcmVzb2x2ZShyZWxhdGl2ZVBhdGgsIG1vZHVsZS5nZXRUYXNrc0RpcmVjdG9yeSgpKTtcbiAgICAgICAgY29uc3QgaGFuZGxlcnNQYXRoID0gbW9kdWxlLmdldFRhc2tGaWxlTmFtZXMoKTtcblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwicmVnaXN0ZXJUYXNrc0Zyb21Nb2R1bGU6OjogbW9kdWxlLXRhc2tzLXBhdGg6IFwiICsgdGFza3NQYXRoKTtcblxuICAgICAgICBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycyh0YXNrc1BhdGgsIGhhbmRsZXJSZWdpc3RyYXIsIGhhbmRsZXJzUGF0aCk7XG4gICAgfVxuXG4gICAgc3RhdGljIHNjYW5Db250cm9sbGVyU291cmNlRmlsZXNGcm9tKGRpcmVjdG9yeVBhdGg6IHN0cmluZykge1xuICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwiU2Nhbm5pbmcgVFMgc291cmNlIGZpbGVzIGZyb20gcGF0aDogXCIsIGRpcmVjdG9yeVBhdGgpO1xuICAgICAgICAvLyBSZXNvbHZlIHRoZSBhYnNvbHV0ZSBwYXRoXG4gICAgICAgIGNvbnN0IHNvdXJjZURpcmVjdG9yeSA9IHJlc29sdmUoZGlyZWN0b3J5UGF0aCk7XG4gICAgICAgIC8vIEdldCBhbGwgdGhlIGZpbGVzIGluIHRoZSBoYW5kbGVyIGRpcmVjdG9yeVxuICAgICAgICBjb25zdCBhbGxEaXJGaWxlcyA9IHJlYWRkaXJTeW5jKHNvdXJjZURpcmVjdG9yeSwgeyByZWN1cnNpdmU6IHRydWUgfSkgYXMgc3RyaW5nW107XG5cbiAgICAgICAgLy8gRmlsdGVyIHRoZSB0ZXN0IGZpbGVzIGFuZCBvbmx5IGluY2x1ZGUgdGhlIHNvdXJjZSBmaWxlc1xuICAgICAgICAvLyBXZSBhbHNvIGxvb2sgZm9yIEpTIGZpbGVzIGFzIHRoZSBGVzI0LW1vZHVsZXMgYXJlIGNvbXBpbGVkIHRvIEpTXG4gICAgICAgIGNvbnN0IHNvdXJjZUZpbGVQYXRocyA9IGFsbERpckZpbGVzLmZpbHRlcigoZmlsZSkgPT4ge1xuXG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgZmlsZS5lbmRzV2l0aChcIi5kLnRzXCIpIC8vIGlnbm9yZSBUeXBlU2NyaXB0IGRlY2xhcmF0aW9uIGZpbGVzXG4gICAgICAgICAgICAgICAgfHwgZmlsZS5lbmRzV2l0aChcIi50ZXN0LnRzXCIpIC8vIGlnbm9yZSB0ZXN0IGZpbGVzXG4gICAgICAgICAgICAgICAgfHwgZmlsZS5lbmRzV2l0aChcIi50ZXN0LmpzXCIpIC8vIGlnbm9yZSB0ZXN0IGZpbGVzXG4gICAgICAgICAgICAgICAgfHwgZmlsZS5lbmRzV2l0aChcIi5pbnRlZ3JhdGlvbi50ZXN0LnRzXCIpIC8vIGlnbm9yZSBpbnRlZ3JhdGlvbiB0ZXN0IGZpbGVzXG4gICAgICAgICAgICAgICAgfHwgZmlsZS5lbmRzV2l0aChcIi5pbnRlZ3JhdGlvbi50ZXN0LmpzXCIpIC8vIGlnbm9yZSBpbnRlZ3JhdGlvbiB0ZXN0IGZpbGVzXG4gICAgICAgICAgICAgICAgfHwgZmlsZS5lbmRzV2l0aChcIi5zcGVjLnRzXCIpIC8vIGlnbm9yZSBzcGVjIGZpbGVzXG4gICAgICAgICAgICAgICAgfHwgZmlsZS5lbmRzV2l0aChcIi5zcGVjLmpzXCIpIC8vIGlnbm9yZSBzcGVjIGZpbGVzXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBmaWxlLmVuZHNXaXRoKFwiLnRzXCIpIHx8IGZpbGUuZW5kc1dpdGgoXCIuanNcIik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBzb3VyY2VGaWxlUGF0aHM7XG4gICAgfVxuXG4gICAgc3RhdGljIGlzRmlmb1F1ZXVlUHJvcHMocHJvcHM6IFF1ZXVlUHJvcHMpIHtcbiAgICAgICAgaWYgKHByb3BzLmZpZm8pIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwcm9wcy5kZWR1cGxpY2F0aW9uU2NvcGUpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwcm9wcy5maWZvVGhyb3VnaHB1dExpbWl0KSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocHJvcHMuY29udGVudEJhc2VkRGVkdXBsaWNhdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHByb3BzLnF1ZXVlTmFtZSAmJiBpc1N0cmluZyhwcm9wcy5xdWV1ZU5hbWUpICYmIHByb3BzLnF1ZXVlTmFtZS5lbmRzV2l0aCgnLmZpZm8nKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogTG9hZCBhIHNpbmdsZSBoYW5kbGVyIGZpbGUgYW5kIGV4dHJhY3QgaXRzIGRlc2NyaXB0b3JzXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIHN0YXRpYyBhc3luYyBsb2FkSGFuZGxlckZpbGUoXG4gICAgICAgIGhhbmRsZXJQYXRoOiBzdHJpbmcsXG4gICAgICAgIGhhbmRsZXJEaXJlY3Rvcnk6IHN0cmluZ1xuICAgICk6IFByb21pc2U8SGFuZGxlckxvYWRSZXN1bHQ+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0OiBIYW5kbGVyTG9hZFJlc3VsdCA9IHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgaGFuZGxlclBhdGgsXG4gICAgICAgICAgICBkZXNjcmlwdG9yczogW11cbiAgICAgICAgfTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhgW1BhcmFsbGVsXSBMb2FkaW5nIGhhbmRsZXIgZmlsZTogJHtoYW5kbGVyUGF0aH1gKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRHluYW1pY2FsbHkgaW1wb3J0IHRoZSBjb250cm9sbGVyIGZpbGVcbiAgICAgICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gam9pbihoYW5kbGVyRGlyZWN0b3J5LCBoYW5kbGVyUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBtb2R1bGUgPSBhd2FpdCBpbXBvcnQoZnVsbFBhdGgpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDYWxjdWxhdGUgbW9kdWxlIGhhc2hcbiAgICAgICAgICAgIGNvbnN0IGZpbGVCdWZmZXIgPSByZWFkRmlsZVN5bmMoZnVsbFBhdGgpO1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlSGFzaCA9IGNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShKU09OLnN0cmluZ2lmeShmaWxlQnVmZmVyKSkuZGlnZXN0KCdoZXgnKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhgW1BhcmFsbGVsXSBMb2FkZWQgbW9kdWxlICR7aGFuZGxlclBhdGh9LCBoYXNoOiAke21vZHVsZUhhc2h9YCk7XG5cbiAgICAgICAgICAgIC8vIEZpbmQgYW5kIGV4dHJhY3QgaGFuZGxlciBjbGFzc2VzXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGV4cG9ydGVkSXRlbSBvZiBPYmplY3QudmFsdWVzKG1vZHVsZSkpIHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydGVkSXRlbSA9PT0gXCJmdW5jdGlvblwiICYmIGV4cG9ydGVkSXRlbS5uYW1lICE9PSBcImhhbmRsZXJcIikge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBkZXNjcmlwdG9yOiBIYW5kbGVyRGVzY3JpcHRvciA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbmRsZXJDbGFzczogZXhwb3J0ZWRJdGVtLFxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZU5hbWU6IGhhbmRsZXJQYXRoLFxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGg6IGhhbmRsZXJEaXJlY3RvcnksXG4gICAgICAgICAgICAgICAgICAgICAgICBoYW5kbGVySGFzaDogbW9kdWxlSGFzaFxuICAgICAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5kZXNjcmlwdG9ycy5wdXNoKGRlc2NyaXB0b3IpO1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKGBbUGFyYWxsZWxdIEZvdW5kIGhhbmRsZXIgY2xhc3MgaW4gJHtoYW5kbGVyUGF0aH06ICR7ZXhwb3J0ZWRJdGVtLm5hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrOyAvLyBPbmx5IHRha2UgdGhlIGZpcnN0IGhhbmRsZXIgY2xhc3MgcGVyIGZpbGVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJlc3VsdC5zdWNjZXNzID0gdHJ1ZTtcbiAgICAgICAgICAgIFxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgcmVzdWx0LnN1Y2Nlc3MgPSBmYWxzZTtcbiAgICAgICAgICAgIHJlc3VsdC5lcnJvciA9IGVycm9yIGFzIEVycm9yO1xuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5lcnJvcihgW1BhcmFsbGVsXSBGYWlsZWQgdG8gbG9hZCBoYW5kbGVyIGZpbGU6ICR7aGFuZGxlclBhdGh9YCwgZXJyb3IpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZWdpc3RlciBoYW5kbGVycyBmcm9tIGEgZGlyZWN0b3J5IHdpdGggcGFyYWxsZWwgZmlsZSBsb2FkaW5nXG4gICAgICogRmlsZXMgYXJlIGxvYWRlZCBpbiBwYXJhbGxlbCBmb3Igc3BlZWQsIGJ1dCBjb25zdHJ1Y3QgcmVnaXN0cmF0aW9uIGlzIHNlcXVlbnRpYWwgZm9yIENESyBzYWZldHlcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcGF0aCAtIERpcmVjdG9yeSBwYXRoIGNvbnRhaW5pbmcgaGFuZGxlciBmaWxlc1xuICAgICAqIEBwYXJhbSBoYW5kbGVyUmVnaXN0cmFyIC0gQ2FsbGJhY2sgdG8gcmVnaXN0ZXIgZWFjaCBoYW5kbGVyXG4gICAgICogQHBhcmFtIGZpbGVzIC0gT3B0aW9uYWwgYXJyYXkgb2Ygc3BlY2lmaWMgZmlsZXMgdG8gbG9hZCAoaWYgZW1wdHksIHNjYW5zIGRpcmVjdG9yeSlcbiAgICAgKiBAcGFyYW0gY29uZmlnIC0gQ29uZmlndXJhdGlvbiBmb3IgcGFyYWxsZWwgbG9hZGluZ1xuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogLy8gVXNlIGRlZmF1bHQgY29uY3VycmVuY3kgKDEwKVxuICAgICAqIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKCcuL3NyYy9jb250cm9sbGVycycsIHJlZ2lzdGVyQ29udHJvbGxlcik7XG4gICAgICogXG4gICAgICogLy8gT3ZlcnJpZGUgY29uY3VycmVuY3kgdmlhIGVudmlyb25tZW50IHZhcmlhYmxlIEZXMjRfSEFORExFUl9MT0FEX0NPTkNVUlJFTkNZXG4gICAgICogcHJvY2Vzcy5lbnYuRlcyNF9IQU5ETEVSX0xPQURfQ09OQ1VSUkVOQ1kgPSAnMjAnO1xuICAgICAqIFxuICAgICAqIC8vIE9yIHBhc3MgY29uZmlnIGRpcmVjdGx5XG4gICAgICogYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMoJy4vc3JjL2NvbnRyb2xsZXJzJywgcmVnaXN0ZXJDb250cm9sbGVyLCBbXSwgeyBtYXhDb25jdXJyZW5jeTogMjAgfSk7XG4gICAgICovXG4gICAgc3RhdGljIGFzeW5jIHJlZ2lzdGVySGFuZGxlcnMoXG4gICAgICAgIHBhdGg6IHN0cmluZywgXG4gICAgICAgIGhhbmRsZXJSZWdpc3RyYXI6IChoYW5kbGVySW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+LCBcbiAgICAgICAgZmlsZXM6IHN0cmluZ1tdID0gW10sXG4gICAgICAgIGNvbmZpZzogUGFyYWxsZWxMb2FkQ29uZmlnID0ge31cbiAgICApIHtcbiAgICAgICAgLy8gQWxsb3cgZW52aXJvbm1lbnQgdmFyaWFibGUgdG8gb3ZlcnJpZGUgY29uY3VycmVuY3lcbiAgICAgICAgY29uc3QgZW52Q29uY3VycmVuY3kgPSBwcm9jZXNzLmVudi5GVzI0X0hBTkRMRVJfTE9BRF9DT05DVVJSRU5DWSBcbiAgICAgICAgICAgID8gcGFyc2VJbnQocHJvY2Vzcy5lbnYuRlcyNF9IQU5ETEVSX0xPQURfQ09OQ1VSUkVOQ1ksIDEwKSBcbiAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgbWF4Q29uY3VycmVuY3kgPSBjb25maWcubWF4Q29uY3VycmVuY3kgPz8gZW52Q29uY3VycmVuY3kgPz8gMTA7XG4gICAgICAgIGNvbnN0IGZhaWxGYXN0ID0gY29uZmlnLmZhaWxGYXN0ID8/IGZhbHNlO1xuXG4gICAgICAgIC8vIFNhZmV0eSBjaGVja1xuICAgICAgICBpZiAobWF4Q29uY3VycmVuY3kgPCAxIHx8IG1heENvbmN1cnJlbmN5ID4gNTApIHtcbiAgICAgICAgICAgIEhlbHBlci5sb2dnZXIud2FybihcbiAgICAgICAgICAgICAgICBgSW52YWxpZCBtYXhDb25jdXJyZW5jeTogJHttYXhDb25jdXJyZW5jeX0uIFVzaW5nIHNhZmUgZGVmYXVsdCBvZiAxMC4gYCArXG4gICAgICAgICAgICAgICAgYFZhbGlkIHJhbmdlOiAxLTUwYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29uc3Qgc2FmZUNvbmN1cnJlbmN5ID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oNTAsIG1heENvbmN1cnJlbmN5KSk7XG5cbiAgICAgICAgY29uc3QgbG9hZFRpbWVyID0gVGltZXIuc3RhcnQoKTtcbiAgICAgICAgSGVscGVyLmxvZ2dlci5pbmZvKGBSZWdpc3RlcmluZyBMYW1iZGEgSGFuZGxlcnMgZnJvbTogJHtwYXRofWApO1xuICAgICAgICBcbiAgICAgICAgLy8gUmVzb2x2ZSB0aGUgYWJzb2x1dGUgcGF0aFxuICAgICAgICBjb25zdCBoYW5kbGVyRGlyZWN0b3J5ID0gcmVzb2x2ZShwYXRoKTtcblxuICAgICAgICAvLyBEZXRlcm1pbmUgd2hpY2ggZmlsZXMgdG8gbG9hZFxuICAgICAgICBsZXQgaGFuZGxlclBhdGhzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICBpZiAoZmlsZXMubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgICAgICBoYW5kbGVyUGF0aHMgPSBmaWxlcztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEZpbHRlciB0aGUgZmlsZXMgdG8gb25seSBpbmNsdWRlIFR5cGVTY3JpcHQgZmlsZXNcbiAgICAgICAgICAgIGhhbmRsZXJQYXRocyA9IEhlbHBlci5zY2FuQ29udHJvbGxlclNvdXJjZUZpbGVzRnJvbShwYXRoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChoYW5kbGVyUGF0aHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLndhcm4oYE5vIGhhbmRsZXIgZmlsZXMgZm91bmQgaW46ICR7cGF0aH1gKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIEhlbHBlci5sb2dnZXIuaW5mbyhg8J+TpiBMb2FkaW5nICR7aGFuZGxlclBhdGhzLmxlbmd0aH0gaGFuZGxlciBmaWxlcyBpbiBwYXJhbGxlbCAoY29uY3VycmVuY3k6ICR7c2FmZUNvbmN1cnJlbmN5fSkuLi5gKTtcblxuICAgICAgICAvLyBQSEFTRSAxOiBMb2FkIGFsbCBmaWxlcyBpbiBwYXJhbGxlbCAod2l0aCBjb25jdXJyZW5jeSBsaW1pdClcbiAgICAgICAgY29uc3QgbG9hZFJlc3VsdHM6IEhhbmRsZXJMb2FkUmVzdWx0W10gPSBbXTtcbiAgICAgICAgY29uc3QgZXJyb3JzOiBBcnJheTx7IGZpbGU6IHN0cmluZzsgZXJyb3I6IEVycm9yIH0+ID0gW107XG4gICAgICAgIFxuICAgICAgICAvLyBQcm9jZXNzIGZpbGVzIGluIGNodW5rcyB0byBsaW1pdCBjb25jdXJyZW5jeVxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGhhbmRsZXJQYXRocy5sZW5ndGg7IGkgKz0gc2FmZUNvbmN1cnJlbmN5KSB7XG4gICAgICAgICAgICBjb25zdCBjaHVuayA9IGhhbmRsZXJQYXRocy5zbGljZShpLCBpICsgc2FmZUNvbmN1cnJlbmN5KTtcbiAgICAgICAgICAgIGNvbnN0IGNodW5rTnVtID0gTWF0aC5mbG9vcihpIC8gc2FmZUNvbmN1cnJlbmN5KSArIDE7XG4gICAgICAgICAgICBjb25zdCB0b3RhbENodW5rcyA9IE1hdGguY2VpbChoYW5kbGVyUGF0aHMubGVuZ3RoIC8gc2FmZUNvbmN1cnJlbmN5KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhgW1BhcmFsbGVsXSBMb2FkaW5nIGNodW5rICR7Y2h1bmtOdW19LyR7dG90YWxDaHVua3N9ICgke2NodW5rLmxlbmd0aH0gZmlsZXMpYCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGNvbnN0IGNodW5rUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICAgICAgICAgIGNodW5rLm1hcChoYW5kbGVyUGF0aCA9PiBcbiAgICAgICAgICAgICAgICAgICAgSGVscGVyLmxvYWRIYW5kbGVyRmlsZShoYW5kbGVyUGF0aCwgaGFuZGxlckRpcmVjdG9yeSlcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBsb2FkUmVzdWx0cy5wdXNoKC4uLmNodW5rUmVzdWx0cyk7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGZvciBlcnJvcnMgaW4gdGhpcyBjaHVua1xuICAgICAgICAgICAgY29uc3QgY2h1bmtFcnJvcnMgPSBjaHVua1Jlc3VsdHMuZmlsdGVyKHIgPT4gIXIuc3VjY2Vzcyk7XG4gICAgICAgICAgICBpZiAoY2h1bmtFcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIGNodW5rRXJyb3JzLmZvckVhY2gociA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChyLmVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvcnMucHVzaCh7IGZpbGU6IHIuaGFuZGxlclBhdGgsIGVycm9yOiByLmVycm9yIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZmFpbEZhc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5lcnJvcihgW1BhcmFsbGVsXSDinYwgRmFpbC1mYXN0IGVuYWJsZWQsIHN0b3BwaW5nIGFmdGVyICR7ZXJyb3JzLmxlbmd0aH0gZXJyb3IocylgKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbG9hZFRpbWVNcyA9IGxvYWRUaW1lci5lbGFwc2VkKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBSZXBvcnQgbG9hZGluZyByZXN1bHRzXG4gICAgICAgIGNvbnN0IHN1Y2Nlc3NDb3VudCA9IGxvYWRSZXN1bHRzLmZpbHRlcihyID0+IHIuc3VjY2VzcykubGVuZ3RoO1xuICAgICAgICBjb25zdCBmYWlsQ291bnQgPSBlcnJvcnMubGVuZ3RoO1xuICAgICAgICBjb25zdCB0b3RhbERlc2NyaXB0b3JzID0gbG9hZFJlc3VsdHMucmVkdWNlKChzdW0sIHIpID0+IHN1bSArIHIuZGVzY3JpcHRvcnMubGVuZ3RoLCAwKTtcblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmluZm8oXG4gICAgICAgICAgICBg4pyTIExvYWRlZCAke3N1Y2Nlc3NDb3VudH0vJHtoYW5kbGVyUGF0aHMubGVuZ3RofSBmaWxlcyBpbiAke2xvYWRUaW1lTXMudG9GaXhlZCgwKX1tcyBgICtcbiAgICAgICAgICAgIGAoJHt0b3RhbERlc2NyaXB0b3JzfSBoYW5kbGVycyBmb3VuZCR7ZmFpbENvdW50ID4gMCA/IGAsICR7ZmFpbENvdW50fSBmYWlsZWRgIDogJyd9KWBcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBGYWlsIGlmIHdlIGhhdmUgZXJyb3JzXG4gICAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5lcnJvcihg4p2MIEZhaWxlZCB0byBsb2FkICR7ZXJyb3JzLmxlbmd0aH0gaGFuZGxlciBmaWxlKHMpOmApO1xuICAgICAgICAgICAgZXJyb3JzLmZvckVhY2goKHsgZmlsZSwgZXJyb3IgfSkgPT4ge1xuICAgICAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZXJyb3IoYCAgLSAke2ZpbGV9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgICBgRmFpbGVkIHRvIGxvYWQgJHtlcnJvcnMubGVuZ3RofSBoYW5kbGVyIGZpbGUocykuIEZpcnN0IGVycm9yOiAke2Vycm9yc1swXS5lcnJvci5tZXNzYWdlfWBcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQSEFTRSAyOiBSZWdpc3RlciBoYW5kbGVycyBzZXF1ZW50aWFsbHkgKENESyBpcyBub3QgdGhyZWFkLXNhZmUpXG4gICAgICAgIGNvbnN0IHJlZ2lzdGVyVGltZXIgPSBUaW1lci5zdGFydCgpO1xuICAgICAgICBIZWxwZXIubG9nZ2VyLmluZm8oYPCflKcgUmVnaXN0ZXJpbmcgJHt0b3RhbERlc2NyaXB0b3JzfSBoYW5kbGVyKHMpIHNlcXVlbnRpYWxseS4uLmApO1xuXG4gICAgICAgIGxldCByZWdpc3RlcmVkQ291bnQgPSAwO1xuICAgICAgICBjb25zdCByZWdpc3RyYXRpb25FcnJvcnM6IEFycmF5PHsgZGVzY3JpcHRvcjogSGFuZGxlckRlc2NyaXB0b3I7IGVycm9yOiBFcnJvciB9PiA9IFtdO1xuXG4gICAgICAgIGZvciAoY29uc3QgcmVzdWx0IG9mIGxvYWRSZXN1bHRzKSB7XG4gICAgICAgICAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSBjb250aW51ZTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCBkZXNjcmlwdG9yIG9mIHJlc3VsdC5kZXNjcmlwdG9ycykge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoXG4gICAgICAgICAgICAgICAgICAgICAgICBgW1NlcXVlbnRpYWxdIFJlZ2lzdGVyaW5nIGhhbmRsZXIgZnJvbSAke2Rlc2NyaXB0b3IuZmlsZU5hbWV9OiAke2Rlc2NyaXB0b3IuaGFuZGxlckNsYXNzLm5hbWV9YFxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgaGFuZGxlclJlZ2lzdHJhcihkZXNjcmlwdG9yKTtcbiAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJlZENvdW50Kys7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGVyciA9IGVycm9yIGFzIEVycm9yO1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgYEZhaWxlZCB0byByZWdpc3RlciBoYW5kbGVyICR7ZGVzY3JpcHRvci5oYW5kbGVyQ2xhc3MubmFtZX0gZnJvbSAke2Rlc2NyaXB0b3IuZmlsZU5hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yXG4gICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgIHJlZ2lzdHJhdGlvbkVycm9ycy5wdXNoKHsgZGVzY3JpcHRvciwgZXJyb3I6IGVyciB9KTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoZmFpbEZhc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgRmFpbGVkIHRvIHJlZ2lzdGVyIGhhbmRsZXIgJHtkZXNjcmlwdG9yLmhhbmRsZXJDbGFzcy5uYW1lfTogJHtlcnIubWVzc2FnZX1gXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVnaXN0ZXJUaW1lTXMgPSByZWdpc3RlclRpbWVyLmVsYXBzZWQoKTtcblxuICAgICAgICAvLyBGaW5hbCByZXBvcnRcbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbkVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmVycm9yKFxuICAgICAgICAgICAgICAgIGDinYwgRmFpbGVkIHRvIHJlZ2lzdGVyICR7cmVnaXN0cmF0aW9uRXJyb3JzLmxlbmd0aH0gaGFuZGxlcihzKTpgXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgcmVnaXN0cmF0aW9uRXJyb3JzLmZvckVhY2goKHsgZGVzY3JpcHRvciwgZXJyb3IgfSkgPT4ge1xuICAgICAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZXJyb3IoYCAgLSAke2Rlc2NyaXB0b3IuaGFuZGxlckNsYXNzLm5hbWV9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgICBgRmFpbGVkIHRvIHJlZ2lzdGVyICR7cmVnaXN0cmF0aW9uRXJyb3JzLmxlbmd0aH0gaGFuZGxlcihzKS4gYCArXG4gICAgICAgICAgICAgICAgYEZpcnN0IGVycm9yOiAke3JlZ2lzdHJhdGlvbkVycm9yc1swXS5lcnJvci5tZXNzYWdlfWBcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmluZm8oXG4gICAgICAgICAgICBg4pyFIFN1Y2Nlc3NmdWxseSByZWdpc3RlcmVkICR7cmVnaXN0ZXJlZENvdW50fSBoYW5kbGVyKHMpIGluICR7cmVnaXN0ZXJUaW1lTXMudG9GaXhlZCgwKX1tcyBgICtcbiAgICAgICAgICAgIGAoVG90YWw6ICR7KGxvYWRUaW1lTXMgKyByZWdpc3RlclRpbWVNcykudG9GaXhlZCgwKX1tcywgYCArXG4gICAgICAgICAgICBgJHsoKGxvYWRUaW1lTXMgKyByZWdpc3RlclRpbWVNcykgLyBoYW5kbGVyUGF0aHMubGVuZ3RoKS50b0ZpeGVkKDApfW1zIHBlciBmaWxlKWBcbiAgICAgICAgKTtcbiAgICB9XG59Il19