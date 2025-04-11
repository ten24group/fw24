import { readdirSync, existsSync, readFile, readFileSync } from "fs";
import { resolve, join, relative,  } from "path";
import HandlerDescriptor from "../interfaces/handler-descriptor";
import { IFw24Module } from "./runtime/module";
import { createLogger, LogDuration } from "../logging";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { isString } from "../utils";
import { createHash } from "crypto";



export class Helper {
    
    static readonly logger = createLogger(Helper.name);

    static hydrateConfig<T>(config: T, prefix = "APP") {
        Object.keys(process.env)
            .filter(key => key.startsWith(prefix))
            .forEach(key => {
                const newKey = key.replace(new RegExp('^' + prefix + '_'), '').toLowerCase().replace(/_./g, x => x[1].toUpperCase());
                if ((config as any)[newKey] === undefined) {
                    (config as any)[newKey] = process.env[key];
                }
            });
    }

    static async registerControllersFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void){
        const basePath = module.getBasePath();

        Helper.logger.debug("registerControllersFromModule::: base-path: " + basePath);

        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = relative('./', basePath); 
        const controllersPath = resolve(relativePath, module.getControllersDirectory());

        // TODO: support for controller path prefix [ e.g. module-name/controller-path ]

        // make sure that the controller path exists
        if( existsSync(controllersPath)){
            
            Helper.logger.debug("registerControllersFromModule::: module-controllers-path: " + controllersPath);

            Helper.registerHandlers(controllersPath, handlerRegistrar);
            
        } else {

            Helper.logger.warn("registerControllersFromModule::: module-controllers-path does not exist: " + controllersPath);
        }

    }

    static async registerQueuesFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void){
        const basePath = module.getBasePath();

        Helper.logger.debug("registerQueuesFromModule::: base-path: " + basePath);

        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = relative('./', basePath); 
        const queuesPath = resolve(relativePath, module.getQueuesDirectory());
        const handlersPath = module.getQueueFileNames();

        Helper.logger.debug("registerQueuesFromModule::: module-queues-path: " + queuesPath);

        Helper.registerHandlers(queuesPath, handlerRegistrar, handlersPath);
    }

    static async registerTasksFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void){
        const basePath = module.getBasePath();

        Helper.logger.debug("registerTasksFromModule::: base-path: " + basePath);

        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = relative('./', basePath); 
        const tasksPath = resolve(relativePath, module.getTasksDirectory());
        const handlersPath = module.getTaskFileNames();

        Helper.logger.debug("registerTasksFromModule::: module-tasks-path: " + tasksPath);

        Helper.registerHandlers(tasksPath, handlerRegistrar, handlersPath);
    }

    static scanTSSourceFilesFrom(path: string){
        Helper.logger.debug("Scanning TS source files from path: ", path);
        // Resolve the absolute path
        const sourceDirectory = resolve(path);
        // Get all the files in the handler directory
        const allDirFiles = readdirSync(sourceDirectory);
        // Filter the files to only include TypeScript files
        const sourceFilePaths = allDirFiles.filter((file) => 
            ( 
                file.endsWith(".ts")
                && !file.endsWith(".d.ts")
            )
             ||
            ( 
                file.endsWith(".js")
            )
        );

        return sourceFilePaths;
    }

    static isFifoQueueProps(props: QueueProps){
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

    static async registerHandlers(path: string, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void, files: string[]=[]) {
        
        Helper.logger.info("Registering Lambda Handlers from: "+ path);
        // Resolve the absolute path
        const handlerDirectory = resolve(path);
    
        let handlerPaths = [];
        if(files.length !== 0){
            handlerPaths = files;
        } else {
            // Filter the files to only include TypeScript files
            handlerPaths = Helper.scanTSSourceFilesFrom(path);
        }

        // Register the handlers
        for (const handlerPath of handlerPaths) {
            Helper.logger.debug("Registering Lambda Handlers from handlerPath: "+ handlerPath);
            // Dynamically import the controller file
            const module = await import(join(handlerDirectory, handlerPath));
            const fileBuffer = readFileSync(join(handlerDirectory, handlerPath));
            const moduleHash = createHash('md5').update(JSON.stringify(fileBuffer)).digest('hex');
            Helper.logger.debug("Registering Lambda Handlers moduleHash: ", {moduleHash});

            // Find and instantiate controller classes
            for (const exportedItem of Object.values(module)) {
                if (typeof exportedItem === "function" && exportedItem.name !== "handler") {
                    Helper.logger.info('handlerdebug',exportedItem,handlerPath,handlerDirectory);
                    const currentHandler: HandlerDescriptor = {
                        handlerClass: exportedItem,
                        fileName: handlerPath,
                        filePath: handlerDirectory,
                        handlerHash: moduleHash
                    };

                    Helper.logger.debug("Registering Lambda Handlers registering currentHandler: ", {handlerPath, handlerDirectory});

                    handlerRegistrar(currentHandler);
                    break;
                } else {
                    Helper.logger.debug("Registering Lambda Handlers ignored exportedItem: ", {exportedItem});
                }
            }
        }
    }
}