import { readdirSync } from "fs";
import { resolve, join, relative } from "path";
import HandlerDescriptor from "../interfaces/handler-descriptor";
import { IFw24Module } from "./module";
import { createLogger, LogDuration } from "../logging";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { isString } from "../utils";



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

        Helper.logger.info("registerControllersFromModule::: base-path: " + basePath);

        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = relative('./', basePath); 
        const controllersPath = resolve(relativePath, module.getControllersDirectory());

        // TODO: support for controller path prefix [ e.g. module-name/controller-path ]

        Helper.logger.info("registerControllersFromModule::: module-controllers-path: " + controllersPath);

        Helper.registerHandlers(controllersPath, handlerRegistrar);
    }

    static async registerQueuesFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void){
        const basePath = module.getBasePath();

        Helper.logger.info("registerQueuesFromModule::: base-path: " + basePath);

        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = relative('./', basePath); 
        const queuesPath = resolve(relativePath, module.getQueuesDirectory());
        const handlersPath = module.getQueueFileNames();

        Helper.logger.info("registerQueuesFromModule::: module-queues-path: " + queuesPath);

        Helper.registerHandlers(queuesPath, handlerRegistrar, handlersPath);
    }

    static async registerTasksFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void){
        const basePath = module.getBasePath();

        Helper.logger.info("registerTasksFromModule::: base-path: " + basePath);

        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = relative('./', basePath); 
        const tasksPath = resolve(relativePath, module.getTasksDirectory());
        const handlersPath = module.getTaskFileNames();

        Helper.logger.info("registerTasksFromModule::: module-tasks-path: " + tasksPath);

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
            try {
                // Dynamically import the controller file
                const module = await import(join(handlerDirectory, handlerPath));

                // Find and instantiate controller classes
                for (const exportedItem of Object.values(module)) {
                    if (typeof exportedItem === "function" && exportedItem.name !== "handler") {
                        const currentHandler: HandlerDescriptor = {
                            handlerClass: exportedItem,
                            fileName: handlerPath,
                            filePath: handlerDirectory,
                        };

                        Helper.logger.debug("Registering Lambda Handlers registering currentHandler: ", {handlerPath, handlerDirectory});

                        handlerRegistrar(currentHandler);
                        break;
                    } else {
                        Helper.logger.debug("Registering Lambda Handlers ignored exportedItem: ", {exportedItem});
                    }
                }
            } catch (err) {
                Helper.logger.error("Error registering handler: ", {handlerDirectory, handlerPath});
                Helper.logger.error(err);
            }
        }
    }
}