import { readdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, join, relative, basename as pathBasename } from "node:path";
import HandlerDescriptor from "../interfaces/handler-descriptor";
import { IFw24Module } from "./runtime/module";
import { createLogger } from "../logging";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { isString, Timer } from "../utils";
import { createHash } from "node:crypto";

/**
 * Result of loading a single handler file
 */
interface HandlerLoadResult {
    success: boolean;
    handlerPath: string;
    descriptors: HandlerDescriptor[];
    error?: Error;
}

/**
 * Configuration for parallel handler loading
 */
interface ParallelLoadConfig {
    /**
     * Maximum number of files to load in parallel
     * @default 10
     */
    maxConcurrency?: number;
    
    /**
     * Whether to fail fast on first error or collect all errors
     * @default false (collect all errors)
     */
    failFast?: boolean;
}

/**
 * Simple timer utility for measuring durations
 */
export class Helper {

    static readonly logger = createLogger(Helper.name);

    static hydrateConfig<T>(config: T, prefix = "APP") {
        Object.keys(process.env)
            .filter(key => key.startsWith(prefix))
            .forEach(key => {
                const newKey = key.replace(new RegExp('^' + prefix + '_'), '').toLowerCase().replace(/_./g, x => x[ 1 ].toUpperCase());
                if ((config as any)[ newKey ] === undefined) {
                    (config as any)[ newKey ] = process.env[ key ];
                }
            });
    }

    static async registerControllersFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void) {
        const basePath = module.getBasePath();

        Helper.logger.debug("registerControllersFromModule::: base-path: " + basePath);

        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = relative('./', basePath);
        const controllersPath = resolve(relativePath, module.getControllersDirectory());

        // TODO: support for controller path prefix [ e.g. module-name/controller-path ]

        // make sure that the controller path exists
        if (existsSync(controllersPath)) {

            Helper.logger.debug("registerControllersFromModule::: module-controllers-path: " + controllersPath);

            Helper.registerHandlers(controllersPath, handlerRegistrar);

        } else {

            Helper.logger.warn("registerControllersFromModule::: module-controllers-path does not exist: " + controllersPath);
        }

    }

    static async registerQueuesFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void) {
        const basePath = module.getBasePath();

        Helper.logger.debug("registerQueuesFromModule::: base-path: " + basePath);

        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = relative('./', basePath);
        const queuesPath = resolve(relativePath, module.getQueuesDirectory());
        const handlersPath = module.getQueueFileNames();

        Helper.logger.debug("registerQueuesFromModule::: module-queues-path: " + queuesPath);

        Helper.registerHandlers(queuesPath, handlerRegistrar, handlersPath);
    }

    static async registerTasksFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void) {
        const basePath = module.getBasePath();

        Helper.logger.debug("registerTasksFromModule::: base-path: " + basePath);

        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = relative('./', basePath);
        const tasksPath = resolve(relativePath, module.getTasksDirectory());
        const handlersPath = module.getTaskFileNames();

        Helper.logger.debug("registerTasksFromModule::: module-tasks-path: " + tasksPath);

        Helper.registerHandlers(tasksPath, handlerRegistrar, handlersPath);
    }

    static scanControllerSourceFilesFrom(directoryPath: string) {
        Helper.logger.debug("Scanning TS source files from path: ", directoryPath);
        // Resolve the absolute path
        const sourceDirectory = resolve(directoryPath);
        // Get all the files in the handler directory
        const allDirFiles = readdirSync(sourceDirectory, { recursive: true }) as string[];

        // Filter the test files and only include the source files
        // We also look for JS files as the FW24-modules are compiled to JS
        const sourceFilePaths = allDirFiles.filter((file) => {

            if (
                file.endsWith(".d.ts") // ignore TypeScript declaration files
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

    static isFifoQueueProps(props: QueueProps) {
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
        if (props.queueName && isString(props.queueName) && props.queueName.endsWith('.fifo')) {
            return true;
        }

        return false;
    }

    /**
     * Load a single handler file and extract its descriptors
     * @private
     */
    private static async loadHandlerFile(
        handlerPath: string,
        handlerDirectory: string
    ): Promise<HandlerLoadResult> {
        const result: HandlerLoadResult = {
            success: false,
            handlerPath,
            descriptors: []
        };

        try {
            Helper.logger.debug(`[Parallel] Loading handler file: ${handlerPath}`);
            
            // Dynamically import the controller file
            const fullPath = join(handlerDirectory, handlerPath);
            const module = await import(fullPath);
            
            // Calculate module hash
            const fileBuffer = readFileSync(fullPath);
            const moduleHash = createHash('md5').update(fileBuffer).digest('hex');
            
            Helper.logger.debug(`[Parallel] Loaded module ${handlerPath}, hash: ${moduleHash}`);

            // Find and extract handler classes
            for (const exportedItem of Object.values(module)) {
                if (typeof exportedItem === "function" && exportedItem.name !== "handler") {
                    const descriptor: HandlerDescriptor = {
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
            
        } catch (error) {
            result.success = false;
            result.error = error as Error;
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
    static async registerHandlers(
        path: string, 
        handlerRegistrar: (handlerInfo: HandlerDescriptor) => void | Promise<void>, 
        files: string[] = [],
        config: ParallelLoadConfig = {}
    ) {
        // Validate inputs
        if (typeof handlerRegistrar !== 'function') {
            throw new Error('handlerRegistrar must be a function');
        }
        
        const loadTimer = Timer.start();
        Helper.logger.info(`Registering Lambda Handlers from: ${path}`);
        
        // Resolve the absolute path
        const handlerDirectory = resolve(path);

        // Determine which files to load
        let handlerPaths: string[] = [];
        if (files.length !== 0) {
            handlerPaths = files;
        } else {
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
        let envConcurrency: number | undefined = undefined;
        if (process.env.FW24_HANDLER_LOAD_CONCURRENCY) {
            const parsed = parseInt(process.env.FW24_HANDLER_LOAD_CONCURRENCY, 10);
            if (!isNaN(parsed) && parsed > 0) {
                envConcurrency = parsed;
            } else {
                Helper.logger.warn(
                    `Invalid FW24_HANDLER_LOAD_CONCURRENCY: "${process.env.FW24_HANDLER_LOAD_CONCURRENCY}". Using default.`
                );
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
        Helper.logger.info(
            `📦 Loading ${handlerPaths.length} handler file(s) ` +
            `[concurrency: ${safeConcurrency}, chunks: ${totalChunks}]...`
        );

        // PHASE 1: Load all files in parallel (with concurrency limit)
        const loadResults: HandlerLoadResult[] = [];
        const errors: Array<{ file: string; error: Error }> = [];
        
        // Process files in chunks to limit concurrency
        for (let i = 0; i < handlerPaths.length; i += safeConcurrency) {
            const chunk = handlerPaths.slice(i, i + safeConcurrency);
            const chunkNum = Math.floor(i / safeConcurrency) + 1;
            const chunkStartTime = Date.now();
            
            // Show which files we're loading in this chunk
            const chunkFileNames = chunk.map(p => pathBasename(p, '.ts')).join(', ');
            Helper.logger.info(
                `   [${chunkNum}/${totalChunks}] Loading: ${chunkFileNames}`
            );
            
            const chunkResults = await Promise.all(
                chunk.map(handlerPath => 
                    Helper.loadHandlerFile(handlerPath, handlerDirectory)
                )
            );

            loadResults.push(...chunkResults);
            
            // Show chunk completion with timing
            const chunkTimeMs = Date.now() - chunkStartTime;
            const loadedSoFar = loadResults.length;
            const chunkDescriptors = chunkResults.reduce((sum, r) => sum + r.descriptors.length, 0);
            Helper.logger.info(
                `   [${chunkNum}/${totalChunks}] ✓ Loaded ${loadedSoFar}/${handlerPaths.length} ` +
                `(+${chunkDescriptors} handler${chunkDescriptors !== 1 ? 's' : ''}) in ${chunkTimeMs}ms`
            );

            // Check for errors in this chunk
            const chunkErrors = chunkResults.filter(r => !r.success);
            if (chunkErrors.length > 0) {
                chunkErrors.forEach(r => {
                    if (r.error) {
                        errors.push({ file: r.handlerPath, error: r.error });
                        Helper.logger.error(`   ❌ Failed to load ${pathBasename(r.handlerPath)}: ${r.error.message}`);
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

        Helper.logger.info(
            `✓ Loaded ${successCount}/${handlerPaths.length} files in ${loadTimeMs.toFixed(0)}ms ` +
            `(${totalDescriptors} handlers found${failCount > 0 ? `, ${failCount} failed` : ''})`
        );

        // Fail if we have errors
        if (errors.length > 0) {
            Helper.logger.error(`❌ Failed to load ${errors.length} handler file(s):`);
            errors.forEach(({ file, error }) => {
                Helper.logger.error(`  - ${file}: ${error.message}`);
            });
            throw new Error(
                `Failed to load ${errors.length} handler file(s). First error: ${errors[0].error.message}`
            );
        }

        // PHASE 2: Register handlers with CDK
        // Note: JavaScript is single-threaded, so even "parallel" registration is serialized by event loop
        // But we keep it sequential to be safe with CDK/Fw24 internal state management
        const registerTimer = Timer.start();
        Helper.logger.info(`🔧 Registering ${totalDescriptors} handler(s) with CDK...`);

        let registeredCount = 0;
        const registrationErrors: Array<{ descriptor: HandlerDescriptor; error: Error }> = [];
        let lastProgressLog = Date.now();
        const progressIntervalMs = 2000; // Log progress every 2 seconds

        for (const result of loadResults) {
            if (!result.success) continue;

            for (const descriptor of result.descriptors) {
                try {
                    Helper.logger.debug(
                        `Registering ${descriptor.handlerClass.name} from ${descriptor.fileName}`
                    );
                    
                    await handlerRegistrar(descriptor);
                    registeredCount++;
                    
                    // Show progress periodically for long-running registrations
                    const now = Date.now();
                    if (now - lastProgressLog > progressIntervalMs && registeredCount < totalDescriptors) {
                        const elapsedMs = registerTimer.elapsed();
                        const avgMs = elapsedMs / registeredCount;
                        const remainingCount = totalDescriptors - registeredCount;
                        const estimatedRemainingMs = Math.round(avgMs * remainingCount);
                        Helper.logger.info(
                            `   ⏳ Progress: ${registeredCount}/${totalDescriptors} registered ` +
                            `(~${Math.round(estimatedRemainingMs / 1000)}s remaining)`
                        );
                        lastProgressLog = now;
                    }
                    
                } catch (error) {
                    const err = error as Error;
                    Helper.logger.error(
                        `Failed to register handler ${descriptor.handlerClass.name} from ${descriptor.fileName}`,
                        error
                    );
                    registrationErrors.push({ descriptor, error: err });

                    if (failFast) {
                        throw new Error(
                            `Failed to register handler ${descriptor.handlerClass.name}: ${err.message}`
                        );
                    }
                }
            }
        }

        const registerTimeMs = registerTimer.elapsed();

        // Final report
        if (registrationErrors.length > 0) {
            Helper.logger.error(
                `❌ Failed to register ${registrationErrors.length} handler(s):`
            );
            registrationErrors.forEach(({ descriptor, error }) => {
                Helper.logger.error(`  - ${descriptor.handlerClass.name}: ${error.message}`);
            });
            throw new Error(
                `Failed to register ${registrationErrors.length} handler(s). ` +
                `First error: ${registrationErrors[0].error.message}`
            );
        }

        const totalTimeMs = loadTimeMs + registerTimeMs;
        const totalTimeSec = (totalTimeMs / 1000).toFixed(1);
        Helper.logger.info(
            `✅ Successfully registered ${registeredCount} handler(s)\n` +
            `   📊 Load time: ${(loadTimeMs / 1000).toFixed(1)}s | ` +
            `Register time: ${(registerTimeMs / 1000).toFixed(1)}s | ` +
            `Total: ${totalTimeSec}s` +
            `${handlerPaths.length > 1 ? ` (${(totalTimeMs / handlerPaths.length).toFixed(0)}ms per file)` : ''}`
        );
    }
}