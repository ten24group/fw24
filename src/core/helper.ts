import { readdirSync } from "fs";
import { resolve, join } from "path";
import HandlerDescriptor from "../interfaces/handler-descriptor";

export class Helper {
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


    static async registerHandlers(path: string, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void) {
        console.log("Registering Lambda Handlers from: ", path);
        // Resolve the absolute path
        const handlerDirectory = resolve(path);
        // Get all the files in the handler directory
        const handlerFiles = readdirSync(handlerDirectory);
        // Filter the files to only include TypeScript files
        const handlerPaths = handlerFiles.filter((file) => file.endsWith(".ts"));
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
                console.error("Error registering handler: ", handlerDirectory, handlerPath, err);
            }
        }
    }
}