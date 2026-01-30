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
            const module = await Promise.resolve(`${fullPath}`).then(s => __importStar(require(s)));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGVscGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvcmUvaGVscGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLHFDQUFnRTtBQUNoRSx5Q0FBOEU7QUFHOUUsd0NBQTBDO0FBRTFDLG9DQUEyQztBQUMzQyw2Q0FBeUM7QUE2QnpDOztHQUVHO0FBQ0gsTUFBYSxNQUFNO0lBRWYsTUFBTSxDQUFVLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRW5ELE1BQU0sQ0FBQyxhQUFhLENBQUksTUFBUyxFQUFFLE1BQU0sR0FBRyxLQUFLO1FBQzdDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQzthQUNuQixNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDO2FBQ3JDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRTtZQUNYLE1BQU0sTUFBTSxHQUFHLEdBQUcsQ0FBQyxPQUFPLENBQUMsSUFBSSxNQUFNLENBQUMsR0FBRyxHQUFHLE1BQU0sR0FBRyxHQUFHLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFFLENBQUMsQ0FBRSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUM7WUFDdkgsSUFBSyxNQUFjLENBQUUsTUFBTSxDQUFFLEtBQUssU0FBUyxFQUFFLENBQUM7Z0JBQ3pDLE1BQWMsQ0FBRSxNQUFNLENBQUUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFFLEdBQUcsQ0FBRSxDQUFDO1lBQ25ELENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNYLENBQUM7SUFFRCxNQUFNLENBQUMsS0FBSyxDQUFDLDZCQUE2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QUUsQ0FDeEQsQ0FBQztRQUNOLENBQUM7UUFFRCxNQUFNLFdBQVcsR0FBRyxVQUFVLEdBQUcsY0FBYyxDQUFDO1FBQ2hELE1BQU0sWUFBWSxHQUFHLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNyRCxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FDZCw2QkFBNkIsZUFBZSxlQUFlO1lBQzNELG9CQUFvQixDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU07WUFDeEQsa0JBQWtCLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTTtZQUMxRCxVQUFVLFlBQVksR0FBRztZQUN6QixHQUFHLFlBQVksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQ3hHLENBQUM7SUFDTixDQUFDOztBQXRaTCx3QkF1WkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyByZWFkZGlyU3luYywgZXhpc3RzU3luYywgcmVhZEZpbGVTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCB7IHJlc29sdmUsIGpvaW4sIHJlbGF0aXZlLCBiYXNlbmFtZSBhcyBwYXRoQmFzZW5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5pbXBvcnQgSGFuZGxlckRlc2NyaXB0b3IgZnJvbSBcIi4uL2ludGVyZmFjZXMvaGFuZGxlci1kZXNjcmlwdG9yXCI7XG5pbXBvcnQgeyBJRncyNE1vZHVsZSB9IGZyb20gXCIuL3J1bnRpbWUvbW9kdWxlXCI7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgUXVldWVQcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBpc1N0cmluZywgVGltZXIgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwibm9kZTpjcnlwdG9cIjtcblxuLyoqXG4gKiBSZXN1bHQgb2YgbG9hZGluZyBhIHNpbmdsZSBoYW5kbGVyIGZpbGVcbiAqL1xuaW50ZXJmYWNlIEhhbmRsZXJMb2FkUmVzdWx0IHtcbiAgICBzdWNjZXNzOiBib29sZWFuO1xuICAgIGhhbmRsZXJQYXRoOiBzdHJpbmc7XG4gICAgZGVzY3JpcHRvcnM6IEhhbmRsZXJEZXNjcmlwdG9yW107XG4gICAgZXJyb3I/OiBFcnJvcjtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBwYXJhbGxlbCBoYW5kbGVyIGxvYWRpbmdcbiAqL1xuaW50ZXJmYWNlIFBhcmFsbGVsTG9hZENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogTWF4aW11bSBudW1iZXIgb2YgZmlsZXMgdG8gbG9hZCBpbiBwYXJhbGxlbFxuICAgICAqIEBkZWZhdWx0IDEwXG4gICAgICovXG4gICAgbWF4Q29uY3VycmVuY3k/OiBudW1iZXI7XG4gICAgXG4gICAgLyoqXG4gICAgICogV2hldGhlciB0byBmYWlsIGZhc3Qgb24gZmlyc3QgZXJyb3Igb3IgY29sbGVjdCBhbGwgZXJyb3JzXG4gICAgICogQGRlZmF1bHQgZmFsc2UgKGNvbGxlY3QgYWxsIGVycm9ycylcbiAgICAgKi9cbiAgICBmYWlsRmFzdD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogU2ltcGxlIHRpbWVyIHV0aWxpdHkgZm9yIG1lYXN1cmluZyBkdXJhdGlvbnNcbiAqL1xuZXhwb3J0IGNsYXNzIEhlbHBlciB7XG5cbiAgICBzdGF0aWMgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEhlbHBlci5uYW1lKTtcblxuICAgIHN0YXRpYyBoeWRyYXRlQ29uZmlnPFQ+KGNvbmZpZzogVCwgcHJlZml4ID0gXCJBUFBcIikge1xuICAgICAgICBPYmplY3Qua2V5cyhwcm9jZXNzLmVudilcbiAgICAgICAgICAgIC5maWx0ZXIoa2V5ID0+IGtleS5zdGFydHNXaXRoKHByZWZpeCkpXG4gICAgICAgICAgICAuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG5ld0tleSA9IGtleS5yZXBsYWNlKG5ldyBSZWdFeHAoJ14nICsgcHJlZml4ICsgJ18nKSwgJycpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXy4vZywgeCA9PiB4WyAxIF0udG9VcHBlckNhc2UoKSk7XG4gICAgICAgICAgICAgICAgaWYgKChjb25maWcgYXMgYW55KVsgbmV3S2V5IF0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICAoY29uZmlnIGFzIGFueSlbIG5ld0tleSBdID0gcHJvY2Vzcy5lbnZbIGtleSBdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgIH1cblxuICAgIHN0YXRpYyBhc3luYyByZWdpc3RlckNvbnRyb2xsZXJzRnJvbU1vZHVsZShtb2R1bGU6IElGdzI0TW9kdWxlLCBoYW5kbGVyUmVnaXN0cmFyOiAoaGFuZGxlckluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB2b2lkKSB7XG4gICAgICAgIGNvbnN0IGJhc2VQYXRoID0gbW9kdWxlLmdldEJhc2VQYXRoKCk7XG5cbiAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcInJlZ2lzdGVyQ29udHJvbGxlcnNGcm9tTW9kdWxlOjo6IGJhc2UtcGF0aDogXCIgKyBiYXNlUGF0aCk7XG5cbiAgICAgICAgLy8gcmVsYXRpdmUgcGF0aCBmcm9tIHRoZSBwbGFjZSB3aGVyZSB0aGUgc2NyaXB0IGlzIGdldHRpbmcgZXhlY3V0ZWQgaS5lIGluZGV4LnRzIGluIGFwcC1yb290XG4gICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHJlbGF0aXZlKCcuLycsIGJhc2VQYXRoKTtcbiAgICAgICAgY29uc3QgY29udHJvbGxlcnNQYXRoID0gcmVzb2x2ZShyZWxhdGl2ZVBhdGgsIG1vZHVsZS5nZXRDb250cm9sbGVyc0RpcmVjdG9yeSgpKTtcblxuICAgICAgICAvLyBUT0RPOiBzdXBwb3J0IGZvciBjb250cm9sbGVyIHBhdGggcHJlZml4IFsgZS5nLiBtb2R1bGUtbmFtZS9jb250cm9sbGVyLXBhdGggXVxuXG4gICAgICAgIC8vIG1ha2Ugc3VyZSB0aGF0IHRoZSBjb250cm9sbGVyIHBhdGggZXhpc3RzXG4gICAgICAgIGlmIChleGlzdHNTeW5jKGNvbnRyb2xsZXJzUGF0aCkpIHtcblxuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcInJlZ2lzdGVyQ29udHJvbGxlcnNGcm9tTW9kdWxlOjo6IG1vZHVsZS1jb250cm9sbGVycy1wYXRoOiBcIiArIGNvbnRyb2xsZXJzUGF0aCk7XG5cbiAgICAgICAgICAgIEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKGNvbnRyb2xsZXJzUGF0aCwgaGFuZGxlclJlZ2lzdHJhcik7XG5cbiAgICAgICAgfSBlbHNlIHtcblxuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci53YXJuKFwicmVnaXN0ZXJDb250cm9sbGVyc0Zyb21Nb2R1bGU6OjogbW9kdWxlLWNvbnRyb2xsZXJzLXBhdGggZG9lcyBub3QgZXhpc3Q6IFwiICsgY29udHJvbGxlcnNQYXRoKTtcbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgc3RhdGljIGFzeW5jIHJlZ2lzdGVyUXVldWVzRnJvbU1vZHVsZShtb2R1bGU6IElGdzI0TW9kdWxlLCBoYW5kbGVyUmVnaXN0cmFyOiAoaGFuZGxlckluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB2b2lkKSB7XG4gICAgICAgIGNvbnN0IGJhc2VQYXRoID0gbW9kdWxlLmdldEJhc2VQYXRoKCk7XG5cbiAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcInJlZ2lzdGVyUXVldWVzRnJvbU1vZHVsZTo6OiBiYXNlLXBhdGg6IFwiICsgYmFzZVBhdGgpO1xuXG4gICAgICAgIC8vIHJlbGF0aXZlIHBhdGggZnJvbSB0aGUgcGxhY2Ugd2hlcmUgdGhlIHNjcmlwdCBpcyBnZXR0aW5nIGV4ZWN1dGVkIGkuZSBpbmRleC50cyBpbiBhcHAtcm9vdFxuICAgICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSByZWxhdGl2ZSgnLi8nLCBiYXNlUGF0aCk7XG4gICAgICAgIGNvbnN0IHF1ZXVlc1BhdGggPSByZXNvbHZlKHJlbGF0aXZlUGF0aCwgbW9kdWxlLmdldFF1ZXVlc0RpcmVjdG9yeSgpKTtcbiAgICAgICAgY29uc3QgaGFuZGxlcnNQYXRoID0gbW9kdWxlLmdldFF1ZXVlRmlsZU5hbWVzKCk7XG5cbiAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcInJlZ2lzdGVyUXVldWVzRnJvbU1vZHVsZTo6OiBtb2R1bGUtcXVldWVzLXBhdGg6IFwiICsgcXVldWVzUGF0aCk7XG5cbiAgICAgICAgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMocXVldWVzUGF0aCwgaGFuZGxlclJlZ2lzdHJhciwgaGFuZGxlcnNQYXRoKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgYXN5bmMgcmVnaXN0ZXJUYXNrc0Zyb21Nb2R1bGUobW9kdWxlOiBJRncyNE1vZHVsZSwgaGFuZGxlclJlZ2lzdHJhcjogKGhhbmRsZXJJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4gdm9pZCkge1xuICAgICAgICBjb25zdCBiYXNlUGF0aCA9IG1vZHVsZS5nZXRCYXNlUGF0aCgpO1xuXG4gICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoXCJyZWdpc3RlclRhc2tzRnJvbU1vZHVsZTo6OiBiYXNlLXBhdGg6IFwiICsgYmFzZVBhdGgpO1xuXG4gICAgICAgIC8vIHJlbGF0aXZlIHBhdGggZnJvbSB0aGUgcGxhY2Ugd2hlcmUgdGhlIHNjcmlwdCBpcyBnZXR0aW5nIGV4ZWN1dGVkIGkuZSBpbmRleC50cyBpbiBhcHAtcm9vdFxuICAgICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSByZWxhdGl2ZSgnLi8nLCBiYXNlUGF0aCk7XG4gICAgICAgIGNvbnN0IHRhc2tzUGF0aCA9IHJlc29sdmUocmVsYXRpdmVQYXRoLCBtb2R1bGUuZ2V0VGFza3NEaXJlY3RvcnkoKSk7XG4gICAgICAgIGNvbnN0IGhhbmRsZXJzUGF0aCA9IG1vZHVsZS5nZXRUYXNrRmlsZU5hbWVzKCk7XG5cbiAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcInJlZ2lzdGVyVGFza3NGcm9tTW9kdWxlOjo6IG1vZHVsZS10YXNrcy1wYXRoOiBcIiArIHRhc2tzUGF0aCk7XG5cbiAgICAgICAgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnModGFza3NQYXRoLCBoYW5kbGVyUmVnaXN0cmFyLCBoYW5kbGVyc1BhdGgpO1xuICAgIH1cblxuICAgIHN0YXRpYyBzY2FuQ29udHJvbGxlclNvdXJjZUZpbGVzRnJvbShkaXJlY3RvcnlQYXRoOiBzdHJpbmcpIHtcbiAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcIlNjYW5uaW5nIFRTIHNvdXJjZSBmaWxlcyBmcm9tIHBhdGg6IFwiLCBkaXJlY3RvcnlQYXRoKTtcbiAgICAgICAgLy8gUmVzb2x2ZSB0aGUgYWJzb2x1dGUgcGF0aFxuICAgICAgICBjb25zdCBzb3VyY2VEaXJlY3RvcnkgPSByZXNvbHZlKGRpcmVjdG9yeVBhdGgpO1xuICAgICAgICAvLyBHZXQgYWxsIHRoZSBmaWxlcyBpbiB0aGUgaGFuZGxlciBkaXJlY3RvcnlcbiAgICAgICAgY29uc3QgYWxsRGlyRmlsZXMgPSByZWFkZGlyU3luYyhzb3VyY2VEaXJlY3RvcnksIHsgcmVjdXJzaXZlOiB0cnVlIH0pIGFzIHN0cmluZ1tdO1xuXG4gICAgICAgIC8vIEZpbHRlciB0aGUgdGVzdCBmaWxlcyBhbmQgb25seSBpbmNsdWRlIHRoZSBzb3VyY2UgZmlsZXNcbiAgICAgICAgLy8gV2UgYWxzbyBsb29rIGZvciBKUyBmaWxlcyBhcyB0aGUgRlcyNC1tb2R1bGVzIGFyZSBjb21waWxlZCB0byBKU1xuICAgICAgICBjb25zdCBzb3VyY2VGaWxlUGF0aHMgPSBhbGxEaXJGaWxlcy5maWx0ZXIoKGZpbGUpID0+IHtcblxuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGZpbGUuZW5kc1dpdGgoXCIuZC50c1wiKSAvLyBpZ25vcmUgVHlwZVNjcmlwdCBkZWNsYXJhdGlvbiBmaWxlc1xuICAgICAgICAgICAgICAgIHx8IGZpbGUuZW5kc1dpdGgoXCIudGVzdC50c1wiKSAvLyBpZ25vcmUgdGVzdCBmaWxlc1xuICAgICAgICAgICAgICAgIHx8IGZpbGUuZW5kc1dpdGgoXCIudGVzdC5qc1wiKSAvLyBpZ25vcmUgdGVzdCBmaWxlc1xuICAgICAgICAgICAgICAgIHx8IGZpbGUuZW5kc1dpdGgoXCIuaW50ZWdyYXRpb24udGVzdC50c1wiKSAvLyBpZ25vcmUgaW50ZWdyYXRpb24gdGVzdCBmaWxlc1xuICAgICAgICAgICAgICAgIHx8IGZpbGUuZW5kc1dpdGgoXCIuaW50ZWdyYXRpb24udGVzdC5qc1wiKSAvLyBpZ25vcmUgaW50ZWdyYXRpb24gdGVzdCBmaWxlc1xuICAgICAgICAgICAgICAgIHx8IGZpbGUuZW5kc1dpdGgoXCIuc3BlYy50c1wiKSAvLyBpZ25vcmUgc3BlYyBmaWxlc1xuICAgICAgICAgICAgICAgIHx8IGZpbGUuZW5kc1dpdGgoXCIuc3BlYy5qc1wiKSAvLyBpZ25vcmUgc3BlYyBmaWxlc1xuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gZmlsZS5lbmRzV2l0aChcIi50c1wiKSB8fCBmaWxlLmVuZHNXaXRoKFwiLmpzXCIpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gc291cmNlRmlsZVBhdGhzO1xuICAgIH1cblxuICAgIHN0YXRpYyBpc0ZpZm9RdWV1ZVByb3BzKHByb3BzOiBRdWV1ZVByb3BzKSB7XG4gICAgICAgIGlmIChwcm9wcy5maWZvKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocHJvcHMuZGVkdXBsaWNhdGlvblNjb3BlKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocHJvcHMuZmlmb1Rocm91Z2hwdXRMaW1pdCkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHByb3BzLmNvbnRlbnRCYXNlZERlZHVwbGljYXRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwcm9wcy5xdWV1ZU5hbWUgJiYgaXNTdHJpbmcocHJvcHMucXVldWVOYW1lKSAmJiBwcm9wcy5xdWV1ZU5hbWUuZW5kc1dpdGgoJy5maWZvJykpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIExvYWQgYSBzaW5nbGUgaGFuZGxlciBmaWxlIGFuZCBleHRyYWN0IGl0cyBkZXNjcmlwdG9yc1xuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgcHJpdmF0ZSBzdGF0aWMgYXN5bmMgbG9hZEhhbmRsZXJGaWxlKFxuICAgICAgICBoYW5kbGVyUGF0aDogc3RyaW5nLFxuICAgICAgICBoYW5kbGVyRGlyZWN0b3J5OiBzdHJpbmdcbiAgICApOiBQcm9taXNlPEhhbmRsZXJMb2FkUmVzdWx0PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdDogSGFuZGxlckxvYWRSZXN1bHQgPSB7XG4gICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgIGhhbmRsZXJQYXRoLFxuICAgICAgICAgICAgZGVzY3JpcHRvcnM6IFtdXG4gICAgICAgIH07XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoYFtQYXJhbGxlbF0gTG9hZGluZyBoYW5kbGVyIGZpbGU6ICR7aGFuZGxlclBhdGh9YCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIER5bmFtaWNhbGx5IGltcG9ydCB0aGUgY29udHJvbGxlciBmaWxlXG4gICAgICAgICAgICBjb25zdCBmdWxsUGF0aCA9IGpvaW4oaGFuZGxlckRpcmVjdG9yeSwgaGFuZGxlclBhdGgpO1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlID0gYXdhaXQgaW1wb3J0KGZ1bGxQYXRoKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ2FsY3VsYXRlIG1vZHVsZSBoYXNoXG4gICAgICAgICAgICBjb25zdCBmaWxlQnVmZmVyID0gcmVhZEZpbGVTeW5jKGZ1bGxQYXRoKTtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZUhhc2ggPSBjcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoZmlsZUJ1ZmZlcikuZGlnZXN0KCdoZXgnKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhgW1BhcmFsbGVsXSBMb2FkZWQgbW9kdWxlICR7aGFuZGxlclBhdGh9LCBoYXNoOiAke21vZHVsZUhhc2h9YCk7XG5cbiAgICAgICAgICAgIC8vIEZpbmQgYW5kIGV4dHJhY3QgaGFuZGxlciBjbGFzc2VzXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGV4cG9ydGVkSXRlbSBvZiBPYmplY3QudmFsdWVzKG1vZHVsZSkpIHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydGVkSXRlbSA9PT0gXCJmdW5jdGlvblwiICYmIGV4cG9ydGVkSXRlbS5uYW1lICE9PSBcImhhbmRsZXJcIikge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBkZXNjcmlwdG9yOiBIYW5kbGVyRGVzY3JpcHRvciA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbmRsZXJDbGFzczogZXhwb3J0ZWRJdGVtLFxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZU5hbWU6IGhhbmRsZXJQYXRoLFxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGg6IGhhbmRsZXJEaXJlY3RvcnksXG4gICAgICAgICAgICAgICAgICAgICAgICBoYW5kbGVySGFzaDogbW9kdWxlSGFzaFxuICAgICAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5kZXNjcmlwdG9ycy5wdXNoKGRlc2NyaXB0b3IpO1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKGBbUGFyYWxsZWxdIEZvdW5kIGhhbmRsZXIgY2xhc3MgaW4gJHtoYW5kbGVyUGF0aH06ICR7ZXhwb3J0ZWRJdGVtLm5hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrOyAvLyBPbmx5IHRha2UgdGhlIGZpcnN0IGhhbmRsZXIgY2xhc3MgcGVyIGZpbGVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJlc3VsdC5zdWNjZXNzID0gdHJ1ZTtcbiAgICAgICAgICAgIFxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgcmVzdWx0LnN1Y2Nlc3MgPSBmYWxzZTtcbiAgICAgICAgICAgIHJlc3VsdC5lcnJvciA9IGVycm9yIGFzIEVycm9yO1xuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5lcnJvcihgW1BhcmFsbGVsXSBGYWlsZWQgdG8gbG9hZCBoYW5kbGVyIGZpbGU6ICR7aGFuZGxlclBhdGh9YCwgZXJyb3IpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZWdpc3RlciBoYW5kbGVycyBmcm9tIGEgZGlyZWN0b3J5IHdpdGggcGFyYWxsZWwgZmlsZSBsb2FkaW5nXG4gICAgICogRmlsZXMgYXJlIGxvYWRlZCBpbiBwYXJhbGxlbCBmb3Igc3BlZWQsIGJ1dCBjb25zdHJ1Y3QgcmVnaXN0cmF0aW9uIGlzIHNlcXVlbnRpYWwgZm9yIENESyBzYWZldHlcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcGF0aCAtIERpcmVjdG9yeSBwYXRoIGNvbnRhaW5pbmcgaGFuZGxlciBmaWxlc1xuICAgICAqIEBwYXJhbSBoYW5kbGVyUmVnaXN0cmFyIC0gQ2FsbGJhY2sgdG8gcmVnaXN0ZXIgZWFjaCBoYW5kbGVyXG4gICAgICogQHBhcmFtIGZpbGVzIC0gT3B0aW9uYWwgYXJyYXkgb2Ygc3BlY2lmaWMgZmlsZXMgdG8gbG9hZCAoaWYgZW1wdHksIHNjYW5zIGRpcmVjdG9yeSlcbiAgICAgKiBAcGFyYW0gY29uZmlnIC0gQ29uZmlndXJhdGlvbiBmb3IgcGFyYWxsZWwgbG9hZGluZ1xuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogLy8gVXNlIGRlZmF1bHQgY29uY3VycmVuY3kgKDUpXG4gICAgICogYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMoJy4vc3JjL2NvbnRyb2xsZXJzJywgcmVnaXN0ZXJDb250cm9sbGVyKTtcbiAgICAgKiBcbiAgICAgKiAvLyBPdmVycmlkZSBjb25jdXJyZW5jeSB2aWEgZW52aXJvbm1lbnQgdmFyaWFibGUgRlcyNF9IQU5ETEVSX0xPQURfQ09OQ1VSUkVOQ1lcbiAgICAgKiBwcm9jZXNzLmVudi5GVzI0X0hBTkRMRVJfTE9BRF9DT05DVVJSRU5DWSA9ICcxMCc7XG4gICAgICogXG4gICAgICogLy8gT3IgcGFzcyBjb25maWcgZGlyZWN0bHlcbiAgICAgKiBhd2FpdCBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycygnLi9zcmMvY29udHJvbGxlcnMnLCByZWdpc3RlckNvbnRyb2xsZXIsIFtdLCB7IG1heENvbmN1cnJlbmN5OiA1IH0pO1xuICAgICAqL1xuICAgIHN0YXRpYyBhc3luYyByZWdpc3RlckhhbmRsZXJzKFxuICAgICAgICBwYXRoOiBzdHJpbmcsIFxuICAgICAgICBoYW5kbGVyUmVnaXN0cmFyOiAoaGFuZGxlckluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPiwgXG4gICAgICAgIGZpbGVzOiBzdHJpbmdbXSA9IFtdLFxuICAgICAgICBjb25maWc6IFBhcmFsbGVsTG9hZENvbmZpZyA9IHt9XG4gICAgKSB7XG4gICAgICAgIC8vIFZhbGlkYXRlIGlucHV0c1xuICAgICAgICBpZiAodHlwZW9mIGhhbmRsZXJSZWdpc3RyYXIgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignaGFuZGxlclJlZ2lzdHJhciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29uc3QgbG9hZFRpbWVyID0gVGltZXIuc3RhcnQoKTtcbiAgICAgICAgSGVscGVyLmxvZ2dlci5pbmZvKGBSZWdpc3RlcmluZyBMYW1iZGEgSGFuZGxlcnMgZnJvbTogJHtwYXRofWApO1xuICAgICAgICBcbiAgICAgICAgLy8gUmVzb2x2ZSB0aGUgYWJzb2x1dGUgcGF0aFxuICAgICAgICBjb25zdCBoYW5kbGVyRGlyZWN0b3J5ID0gcmVzb2x2ZShwYXRoKTtcblxuICAgICAgICAvLyBEZXRlcm1pbmUgd2hpY2ggZmlsZXMgdG8gbG9hZFxuICAgICAgICBsZXQgaGFuZGxlclBhdGhzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICBpZiAoZmlsZXMubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgICAgICBoYW5kbGVyUGF0aHMgPSBmaWxlcztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEZpbHRlciB0aGUgZmlsZXMgdG8gb25seSBpbmNsdWRlIFR5cGVTY3JpcHQgZmlsZXNcbiAgICAgICAgICAgIGhhbmRsZXJQYXRocyA9IEhlbHBlci5zY2FuQ29udHJvbGxlclNvdXJjZUZpbGVzRnJvbShwYXRoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChoYW5kbGVyUGF0aHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLndhcm4oYE5vIGhhbmRsZXIgZmlsZXMgZm91bmQgaW46ICR7cGF0aH1gKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENvbmN1cnJlbmN5IGNvbmZpZ3VyYXRpb25cbiAgICAgICAgLy8gRGVmYXVsdDogNSAoY29uc2VydmF0aXZlLCBhdm9pZHMgbW9kdWxlIHJlc29sdXRpb24gY29udGVudGlvbiBmb3IgbGFyZ2UgZmlsZXMgbGlrZSBkaS50cylcbiAgICAgICAgLy8gT3ZlcnJpZGUgdmlhIGNvbmZpZy5tYXhDb25jdXJyZW5jeSBvciBlbnYgdmFyIEZXMjRfSEFORExFUl9MT0FEX0NPTkNVUlJFTkNZXG4gICAgICAgIGxldCBlbnZDb25jdXJyZW5jeTogbnVtYmVyIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICAgICAgICBpZiAocHJvY2Vzcy5lbnYuRlcyNF9IQU5ETEVSX0xPQURfQ09OQ1VSUkVOQ1kpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlSW50KHByb2Nlc3MuZW52LkZXMjRfSEFORExFUl9MT0FEX0NPTkNVUlJFTkNZLCAxMCk7XG4gICAgICAgICAgICBpZiAoIWlzTmFOKHBhcnNlZCkgJiYgcGFyc2VkID4gMCkge1xuICAgICAgICAgICAgICAgIGVudkNvbmN1cnJlbmN5ID0gcGFyc2VkO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBIZWxwZXIubG9nZ2VyLndhcm4oXG4gICAgICAgICAgICAgICAgICAgIGBJbnZhbGlkIEZXMjRfSEFORExFUl9MT0FEX0NPTkNVUlJFTkNZOiBcIiR7cHJvY2Vzcy5lbnYuRlcyNF9IQU5ETEVSX0xPQURfQ09OQ1VSUkVOQ1l9XCIuIFVzaW5nIGRlZmF1bHQuYFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGNvbnN0IG1heENvbmN1cnJlbmN5ID0gY29uZmlnLm1heENvbmN1cnJlbmN5ID8/IGVudkNvbmN1cnJlbmN5ID8/IDU7XG4gICAgICAgIGNvbnN0IGZhaWxGYXN0ID0gY29uZmlnLmZhaWxGYXN0ID8/IGZhbHNlO1xuXG4gICAgICAgIC8vIENsYW1wIHRvIHNhZmUgcmFuZ2VcbiAgICAgICAgY29uc3Qgc2FmZUNvbmN1cnJlbmN5ID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oNTAsIG1heENvbmN1cnJlbmN5KSk7XG4gICAgICAgIFxuICAgICAgICBpZiAoc2FmZUNvbmN1cnJlbmN5ICE9PSBtYXhDb25jdXJyZW5jeSkge1xuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci53YXJuKGBDb25jdXJyZW5jeSAke21heENvbmN1cnJlbmN5fSBjbGFtcGVkIHRvICR7c2FmZUNvbmN1cnJlbmN5fSAodmFsaWQgcmFuZ2U6IDEtNTApYCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0b3RhbENodW5rcyA9IE1hdGguY2VpbChoYW5kbGVyUGF0aHMubGVuZ3RoIC8gc2FmZUNvbmN1cnJlbmN5KTtcbiAgICAgICAgSGVscGVyLmxvZ2dlci5pbmZvKFxuICAgICAgICAgICAgYPCfk6YgTG9hZGluZyAke2hhbmRsZXJQYXRocy5sZW5ndGh9IGhhbmRsZXIgZmlsZShzKSBgICtcbiAgICAgICAgICAgIGBbY29uY3VycmVuY3k6ICR7c2FmZUNvbmN1cnJlbmN5fSwgY2h1bmtzOiAke3RvdGFsQ2h1bmtzfV0uLi5gXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gUEhBU0UgMTogTG9hZCBhbGwgZmlsZXMgaW4gcGFyYWxsZWwgKHdpdGggY29uY3VycmVuY3kgbGltaXQpXG4gICAgICAgIGNvbnN0IGxvYWRSZXN1bHRzOiBIYW5kbGVyTG9hZFJlc3VsdFtdID0gW107XG4gICAgICAgIGNvbnN0IGVycm9yczogQXJyYXk8eyBmaWxlOiBzdHJpbmc7IGVycm9yOiBFcnJvciB9PiA9IFtdO1xuICAgICAgICBcbiAgICAgICAgLy8gUHJvY2VzcyBmaWxlcyBpbiBjaHVua3MgdG8gbGltaXQgY29uY3VycmVuY3lcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBoYW5kbGVyUGF0aHMubGVuZ3RoOyBpICs9IHNhZmVDb25jdXJyZW5jeSkge1xuICAgICAgICAgICAgY29uc3QgY2h1bmsgPSBoYW5kbGVyUGF0aHMuc2xpY2UoaSwgaSArIHNhZmVDb25jdXJyZW5jeSk7XG4gICAgICAgICAgICBjb25zdCBjaHVua051bSA9IE1hdGguZmxvb3IoaSAvIHNhZmVDb25jdXJyZW5jeSkgKyAxO1xuICAgICAgICAgICAgY29uc3QgY2h1bmtTdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBTaG93IHdoaWNoIGZpbGVzIHdlJ3JlIGxvYWRpbmcgaW4gdGhpcyBjaHVua1xuICAgICAgICAgICAgY29uc3QgY2h1bmtGaWxlTmFtZXMgPSBjaHVuay5tYXAocCA9PiBwYXRoQmFzZW5hbWUocCwgJy50cycpKS5qb2luKCcsICcpO1xuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5pbmZvKFxuICAgICAgICAgICAgICAgIGAgICBbJHtjaHVua051bX0vJHt0b3RhbENodW5rc31dIExvYWRpbmc6ICR7Y2h1bmtGaWxlTmFtZXN9YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY29uc3QgY2h1bmtSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgICAgICAgICAgY2h1bmsubWFwKGhhbmRsZXJQYXRoID0+IFxuICAgICAgICAgICAgICAgICAgICBIZWxwZXIubG9hZEhhbmRsZXJGaWxlKGhhbmRsZXJQYXRoLCBoYW5kbGVyRGlyZWN0b3J5KVxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGxvYWRSZXN1bHRzLnB1c2goLi4uY2h1bmtSZXN1bHRzKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gU2hvdyBjaHVuayBjb21wbGV0aW9uIHdpdGggdGltaW5nXG4gICAgICAgICAgICBjb25zdCBjaHVua1RpbWVNcyA9IERhdGUubm93KCkgLSBjaHVua1N0YXJ0VGltZTtcbiAgICAgICAgICAgIGNvbnN0IGxvYWRlZFNvRmFyID0gbG9hZFJlc3VsdHMubGVuZ3RoO1xuICAgICAgICAgICAgY29uc3QgY2h1bmtEZXNjcmlwdG9ycyA9IGNodW5rUmVzdWx0cy5yZWR1Y2UoKHN1bSwgcikgPT4gc3VtICsgci5kZXNjcmlwdG9ycy5sZW5ndGgsIDApO1xuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5pbmZvKFxuICAgICAgICAgICAgICAgIGAgICBbJHtjaHVua051bX0vJHt0b3RhbENodW5rc31dIOKckyBMb2FkZWQgJHtsb2FkZWRTb0Zhcn0vJHtoYW5kbGVyUGF0aHMubGVuZ3RofSBgICtcbiAgICAgICAgICAgICAgICBgKCske2NodW5rRGVzY3JpcHRvcnN9IGhhbmRsZXIke2NodW5rRGVzY3JpcHRvcnMgIT09IDEgPyAncycgOiAnJ30pIGluICR7Y2h1bmtUaW1lTXN9bXNgXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgZXJyb3JzIGluIHRoaXMgY2h1bmtcbiAgICAgICAgICAgIGNvbnN0IGNodW5rRXJyb3JzID0gY2h1bmtSZXN1bHRzLmZpbHRlcihyID0+ICFyLnN1Y2Nlc3MpO1xuICAgICAgICAgICAgaWYgKGNodW5rRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBjaHVua0Vycm9ycy5mb3JFYWNoKHIgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoci5lcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JzLnB1c2goeyBmaWxlOiByLmhhbmRsZXJQYXRoLCBlcnJvcjogci5lcnJvciB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZXJyb3IoYCAgIOKdjCBGYWlsZWQgdG8gbG9hZCAke3BhdGhCYXNlbmFtZShyLmhhbmRsZXJQYXRoKX06ICR7ci5lcnJvci5tZXNzYWdlfWApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZmFpbEZhc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5lcnJvcihgICAg4p2MIEZhaWwtZmFzdCBlbmFibGVkLCBzdG9wcGluZyBhZnRlciAke2Vycm9ycy5sZW5ndGh9IGVycm9yKHMpYCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxvYWRUaW1lTXMgPSBsb2FkVGltZXIuZWxhcHNlZCgpO1xuICAgICAgICBcbiAgICAgICAgLy8gUmVwb3J0IGxvYWRpbmcgcmVzdWx0c1xuICAgICAgICBjb25zdCBzdWNjZXNzQ291bnQgPSBsb2FkUmVzdWx0cy5maWx0ZXIociA9PiByLnN1Y2Nlc3MpLmxlbmd0aDtcbiAgICAgICAgY29uc3QgZmFpbENvdW50ID0gZXJyb3JzLmxlbmd0aDtcbiAgICAgICAgY29uc3QgdG90YWxEZXNjcmlwdG9ycyA9IGxvYWRSZXN1bHRzLnJlZHVjZSgoc3VtLCByKSA9PiBzdW0gKyByLmRlc2NyaXB0b3JzLmxlbmd0aCwgMCk7XG5cbiAgICAgICAgSGVscGVyLmxvZ2dlci5pbmZvKFxuICAgICAgICAgICAgYOKckyBMb2FkZWQgJHtzdWNjZXNzQ291bnR9LyR7aGFuZGxlclBhdGhzLmxlbmd0aH0gZmlsZXMgaW4gJHtsb2FkVGltZU1zLnRvRml4ZWQoMCl9bXMgYCArXG4gICAgICAgICAgICBgKCR7dG90YWxEZXNjcmlwdG9yc30gaGFuZGxlcnMgZm91bmQke2ZhaWxDb3VudCA+IDAgPyBgLCAke2ZhaWxDb3VudH0gZmFpbGVkYCA6ICcnfSlgXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gRmFpbCBpZiB3ZSBoYXZlIGVycm9yc1xuICAgICAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZXJyb3IoYOKdjCBGYWlsZWQgdG8gbG9hZCAke2Vycm9ycy5sZW5ndGh9IGhhbmRsZXIgZmlsZShzKTpgKTtcbiAgICAgICAgICAgIGVycm9ycy5mb3JFYWNoKCh7IGZpbGUsIGVycm9yIH0pID0+IHtcbiAgICAgICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmVycm9yKGAgIC0gJHtmaWxlfTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgYEZhaWxlZCB0byBsb2FkICR7ZXJyb3JzLmxlbmd0aH0gaGFuZGxlciBmaWxlKHMpLiBGaXJzdCBlcnJvcjogJHtlcnJvcnNbMF0uZXJyb3IubWVzc2FnZX1gXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUEhBU0UgMjogUmVnaXN0ZXIgaGFuZGxlcnMgd2l0aCBDREtcbiAgICAgICAgLy8gTm90ZTogSmF2YVNjcmlwdCBpcyBzaW5nbGUtdGhyZWFkZWQsIHNvIGV2ZW4gXCJwYXJhbGxlbFwiIHJlZ2lzdHJhdGlvbiBpcyBzZXJpYWxpemVkIGJ5IGV2ZW50IGxvb3BcbiAgICAgICAgLy8gQnV0IHdlIGtlZXAgaXQgc2VxdWVudGlhbCB0byBiZSBzYWZlIHdpdGggQ0RLL0Z3MjQgaW50ZXJuYWwgc3RhdGUgbWFuYWdlbWVudFxuICAgICAgICBjb25zdCByZWdpc3RlclRpbWVyID0gVGltZXIuc3RhcnQoKTtcbiAgICAgICAgSGVscGVyLmxvZ2dlci5pbmZvKGDwn5SnIFJlZ2lzdGVyaW5nICR7dG90YWxEZXNjcmlwdG9yc30gaGFuZGxlcihzKSB3aXRoIENESy4uLmApO1xuXG4gICAgICAgIGxldCByZWdpc3RlcmVkQ291bnQgPSAwO1xuICAgICAgICBjb25zdCByZWdpc3RyYXRpb25FcnJvcnM6IEFycmF5PHsgZGVzY3JpcHRvcjogSGFuZGxlckRlc2NyaXB0b3I7IGVycm9yOiBFcnJvciB9PiA9IFtdO1xuICAgICAgICBsZXQgbGFzdFByb2dyZXNzTG9nID0gRGF0ZS5ub3coKTtcbiAgICAgICAgY29uc3QgcHJvZ3Jlc3NJbnRlcnZhbE1zID0gMjAwMDsgLy8gTG9nIHByb2dyZXNzIGV2ZXJ5IDIgc2Vjb25kc1xuXG4gICAgICAgIGZvciAoY29uc3QgcmVzdWx0IG9mIGxvYWRSZXN1bHRzKSB7XG4gICAgICAgICAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSBjb250aW51ZTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCBkZXNjcmlwdG9yIG9mIHJlc3VsdC5kZXNjcmlwdG9ycykge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoXG4gICAgICAgICAgICAgICAgICAgICAgICBgUmVnaXN0ZXJpbmcgJHtkZXNjcmlwdG9yLmhhbmRsZXJDbGFzcy5uYW1lfSBmcm9tICR7ZGVzY3JpcHRvci5maWxlTmFtZX1gXG4gICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBoYW5kbGVyUmVnaXN0cmFyKGRlc2NyaXB0b3IpO1xuICAgICAgICAgICAgICAgICAgICByZWdpc3RlcmVkQ291bnQrKztcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIFNob3cgcHJvZ3Jlc3MgcGVyaW9kaWNhbGx5IGZvciBsb25nLXJ1bm5pbmcgcmVnaXN0cmF0aW9uc1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgICAgICAgICAgICAgICAgICBpZiAobm93IC0gbGFzdFByb2dyZXNzTG9nID4gcHJvZ3Jlc3NJbnRlcnZhbE1zICYmIHJlZ2lzdGVyZWRDb3VudCA8IHRvdGFsRGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVsYXBzZWRNcyA9IHJlZ2lzdGVyVGltZXIuZWxhcHNlZCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYXZnTXMgPSBlbGFwc2VkTXMgLyByZWdpc3RlcmVkQ291bnQ7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZW1haW5pbmdDb3VudCA9IHRvdGFsRGVzY3JpcHRvcnMgLSByZWdpc3RlcmVkQ291bnQ7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlc3RpbWF0ZWRSZW1haW5pbmdNcyA9IE1hdGgucm91bmQoYXZnTXMgKiByZW1haW5pbmdDb3VudCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmluZm8oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgIOKPsyBQcm9ncmVzczogJHtyZWdpc3RlcmVkQ291bnR9LyR7dG90YWxEZXNjcmlwdG9yc30gcmVnaXN0ZXJlZCBgICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgKH4ke01hdGgucm91bmQoZXN0aW1hdGVkUmVtYWluaW5nTXMgLyAxMDAwKX1zIHJlbWFpbmluZylgXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgbGFzdFByb2dyZXNzTG9nID0gbm93O1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGVyciA9IGVycm9yIGFzIEVycm9yO1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgYEZhaWxlZCB0byByZWdpc3RlciBoYW5kbGVyICR7ZGVzY3JpcHRvci5oYW5kbGVyQ2xhc3MubmFtZX0gZnJvbSAke2Rlc2NyaXB0b3IuZmlsZU5hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yXG4gICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgIHJlZ2lzdHJhdGlvbkVycm9ycy5wdXNoKHsgZGVzY3JpcHRvciwgZXJyb3I6IGVyciB9KTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoZmFpbEZhc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgRmFpbGVkIHRvIHJlZ2lzdGVyIGhhbmRsZXIgJHtkZXNjcmlwdG9yLmhhbmRsZXJDbGFzcy5uYW1lfTogJHtlcnIubWVzc2FnZX1gXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVnaXN0ZXJUaW1lTXMgPSByZWdpc3RlclRpbWVyLmVsYXBzZWQoKTtcblxuICAgICAgICAvLyBGaW5hbCByZXBvcnRcbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbkVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmVycm9yKFxuICAgICAgICAgICAgICAgIGDinYwgRmFpbGVkIHRvIHJlZ2lzdGVyICR7cmVnaXN0cmF0aW9uRXJyb3JzLmxlbmd0aH0gaGFuZGxlcihzKTpgXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgcmVnaXN0cmF0aW9uRXJyb3JzLmZvckVhY2goKHsgZGVzY3JpcHRvciwgZXJyb3IgfSkgPT4ge1xuICAgICAgICAgICAgICAgIEhlbHBlci5sb2dnZXIuZXJyb3IoYCAgLSAke2Rlc2NyaXB0b3IuaGFuZGxlckNsYXNzLm5hbWV9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgICBgRmFpbGVkIHRvIHJlZ2lzdGVyICR7cmVnaXN0cmF0aW9uRXJyb3JzLmxlbmd0aH0gaGFuZGxlcihzKS4gYCArXG4gICAgICAgICAgICAgICAgYEZpcnN0IGVycm9yOiAke3JlZ2lzdHJhdGlvbkVycm9yc1swXS5lcnJvci5tZXNzYWdlfWBcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0b3RhbFRpbWVNcyA9IGxvYWRUaW1lTXMgKyByZWdpc3RlclRpbWVNcztcbiAgICAgICAgY29uc3QgdG90YWxUaW1lU2VjID0gKHRvdGFsVGltZU1zIC8gMTAwMCkudG9GaXhlZCgxKTtcbiAgICAgICAgSGVscGVyLmxvZ2dlci5pbmZvKFxuICAgICAgICAgICAgYOKchSBTdWNjZXNzZnVsbHkgcmVnaXN0ZXJlZCAke3JlZ2lzdGVyZWRDb3VudH0gaGFuZGxlcihzKVxcbmAgK1xuICAgICAgICAgICAgYCAgIPCfk4ogTG9hZCB0aW1lOiAkeyhsb2FkVGltZU1zIC8gMTAwMCkudG9GaXhlZCgxKX1zIHwgYCArXG4gICAgICAgICAgICBgUmVnaXN0ZXIgdGltZTogJHsocmVnaXN0ZXJUaW1lTXMgLyAxMDAwKS50b0ZpeGVkKDEpfXMgfCBgICtcbiAgICAgICAgICAgIGBUb3RhbDogJHt0b3RhbFRpbWVTZWN9c2AgK1xuICAgICAgICAgICAgYCR7aGFuZGxlclBhdGhzLmxlbmd0aCA+IDEgPyBgICgkeyh0b3RhbFRpbWVNcyAvIGhhbmRsZXJQYXRocy5sZW5ndGgpLnRvRml4ZWQoMCl9bXMgcGVyIGZpbGUpYCA6ICcnfWBcbiAgICAgICAgKTtcbiAgICB9XG59Il19