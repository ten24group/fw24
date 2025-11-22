import { readdirSync, existsSync, readFile, readFileSync, statSync } from "fs";
import { resolve, join, relative, } from "path";
import HandlerDescriptor from "../interfaces/handler-descriptor";
import { IFw24Module } from "./runtime/module";
import { createLogger, LogDuration } from "../logging";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { isString } from "../utils";
import { createHash } from "crypto";

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
class Timer {
    private startTime: number;

    constructor() {
        this.startTime = Date.now();
    }

    elapsed(): number {
        return Date.now() - this.startTime;
    }

    static start(): Timer {
        return new Timer();
    }
}



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
            const moduleHash = createHash('md5').update(JSON.stringify(fileBuffer)).digest('hex');
            
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
     * // Use default concurrency (10)
     * await Helper.registerHandlers('./src/controllers', registerController);
     * 
     * // Override concurrency via environment variable FW24_HANDLER_LOAD_CONCURRENCY
     * process.env.FW24_HANDLER_LOAD_CONCURRENCY = '20';
     * 
     * // Or pass config directly
     * await Helper.registerHandlers('./src/controllers', registerController, [], { maxConcurrency: 20 });
     */
    static async registerHandlers(
        path: string, 
        handlerRegistrar: (handlerInfo: HandlerDescriptor) => void | Promise<void>, 
        files: string[] = [],
        config: ParallelLoadConfig = {}
    ) {
        // Allow environment variable to override concurrency
        const envConcurrency = process.env.FW24_HANDLER_LOAD_CONCURRENCY 
            ? parseInt(process.env.FW24_HANDLER_LOAD_CONCURRENCY, 10) 
            : undefined;
        
        const maxConcurrency = config.maxConcurrency ?? envConcurrency ?? 10;
        const failFast = config.failFast ?? false;

        // Safety check
        if (maxConcurrency < 1 || maxConcurrency > 50) {
            Helper.logger.warn(
                `Invalid maxConcurrency: ${maxConcurrency}. Using safe default of 10. ` +
                `Valid range: 1-50`
            );
        }
        
        const safeConcurrency = Math.max(1, Math.min(50, maxConcurrency));

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

        Helper.logger.info(`📦 Loading ${handlerPaths.length} handler files in parallel (concurrency: ${safeConcurrency})...`);

        // PHASE 1: Load all files in parallel (with concurrency limit)
        const loadResults: HandlerLoadResult[] = [];
        const errors: Array<{ file: string; error: Error }> = [];
        
        // Process files in chunks to limit concurrency
        for (let i = 0; i < handlerPaths.length; i += safeConcurrency) {
            const chunk = handlerPaths.slice(i, i + safeConcurrency);
            const chunkNum = Math.floor(i / safeConcurrency) + 1;
            const totalChunks = Math.ceil(handlerPaths.length / safeConcurrency);
            
            Helper.logger.debug(`[Parallel] Loading chunk ${chunkNum}/${totalChunks} (${chunk.length} files)`);
            
            const chunkResults = await Promise.all(
                chunk.map(handlerPath => 
                    Helper.loadHandlerFile(handlerPath, handlerDirectory)
                )
            );

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

        // PHASE 2: Register handlers sequentially (CDK is not thread-safe)
        const registerTimer = Timer.start();
        Helper.logger.info(`🔧 Registering ${totalDescriptors} handler(s) sequentially...`);

        let registeredCount = 0;
        const registrationErrors: Array<{ descriptor: HandlerDescriptor; error: Error }> = [];

        for (const result of loadResults) {
            if (!result.success) continue;

            for (const descriptor of result.descriptors) {
                try {
                    Helper.logger.debug(
                        `[Sequential] Registering handler from ${descriptor.fileName}: ${descriptor.handlerClass.name}`
                    );
                    
                    await handlerRegistrar(descriptor);
                    registeredCount++;
                    
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

        Helper.logger.info(
            `✅ Successfully registered ${registeredCount} handler(s) in ${registerTimeMs.toFixed(0)}ms ` +
            `(Total: ${(loadTimeMs + registerTimeMs).toFixed(0)}ms, ` +
            `${((loadTimeMs + registerTimeMs) / handlerPaths.length).toFixed(0)}ms per file)`
        );
    }
}