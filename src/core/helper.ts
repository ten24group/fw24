import { readdirSync } from "fs";
import { resolve, join, relative } from "path";
import HandlerDescriptor from "../interfaces/handler-descriptor";
import { IFw24Module } from "./module";
import { createLogger, Duration as LogDuration, InOut as LogInOut } from "../fw24";



export class Helper {
    
    static logger = createLogger('Helper');

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

    @LogDuration()
    static registerControllersFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void){
        const basePath = module.getBasePath();

        Helper.logger.debug("registerControllersFromModule::: base-path: ", basePath);

        // relative path from the place where the script is getting executed i.e index.ts in app-root
        const relativePath = relative('./', basePath); 
        const controllersPath = resolve(relativePath, module.getControllersDirectory());

        // TODO: support for controller path prefix [ e.g. module-name/controller-path ]

        Helper.logger.debug("registerControllersFromModule::: module-controllers-path:", controllersPath);

        Helper.registerHandlers(controllersPath, handlerRegistrar);
    }

    @LogDuration()
    @LogInOut()
    static scanTSSourceFilesFrom(path: string){
        Helper.logger.debug("Scanning TS source files from path: ", path);
        // Resolve the absolute path
        const sourceDirectory = resolve(path);
        // Get all the files in the handler directory
        const allDirFiles = readdirSync(sourceDirectory);
        // Filter the files to only include TypeScript files
        const sourceFilePaths = allDirFiles.filter((file) => 
            file.endsWith(".ts") 
            && !file.endsWith("d.ts") 
            && !file.endsWith("test.ts") 
            && !file.endsWith("spec.ts")
        );

        return sourceFilePaths;
    }

    static async registerHandlers(path: string, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void) {
        
        Helper.logger.debug("Registering Lambda Handlers from: ", path);
        
        // Resolve the absolute path
        const handlerDirectory = resolve(path);
        // Filter the files to only include TypeScript files
        const handlerPaths = Helper.scanTSSourceFilesFrom(path);

        // Register the handlers
        for (const handlerPath of handlerPaths) {
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
                        handlerRegistrar(currentHandler);
                        break;
                    }
                }
            } catch (err) {
                Helper.logger.error("Error registering handler: ", handlerDirectory, handlerPath, err);
            }
        }
    }
}