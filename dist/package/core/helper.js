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
    static async registerHandlers(path, handlerRegistrar, files = []) {
        Helper.logger.info("Registering Lambda Handlers from: " + path);
        // Resolve the absolute path
        const handlerDirectory = (0, path_1.resolve)(path);
        let handlerPaths = [];
        if (files.length !== 0) {
            handlerPaths = files;
        }
        else {
            // Filter the files to only include TypeScript files
            handlerPaths = Helper.scanControllerSourceFilesFrom(path);
        }
        // Register the handlers
        for (const handlerPath of handlerPaths) {
            Helper.logger.debug("Registering Lambda Handlers from handlerPath: " + handlerPath);
            // Dynamically import the controller file
            const module = await Promise.resolve(`${(0, path_1.join)(handlerDirectory, handlerPath)}`).then(s => __importStar(require(s)));
            const fileBuffer = (0, fs_1.readFileSync)((0, path_1.join)(handlerDirectory, handlerPath));
            const moduleHash = (0, crypto_1.createHash)('md5').update(JSON.stringify(fileBuffer)).digest('hex');
            Helper.logger.debug("Registering Lambda Handlers moduleHash: ", { moduleHash });
            // Find and instantiate controller classes
            for (const exportedItem of Object.values(module)) {
                if (typeof exportedItem === "function" && exportedItem.name !== "handler") {
                    const currentHandler = {
                        handlerClass: exportedItem,
                        fileName: handlerPath,
                        filePath: handlerDirectory,
                        handlerHash: moduleHash
                    };
                    Helper.logger.debug("Registering Lambda Handlers registering currentHandler: ", { handlerPath, handlerDirectory });
                    handlerRegistrar(currentHandler);
                    break;
                }
                else {
                    Helper.logger.debug("Registering Lambda Handlers ignored exportedItem: ", { exportedItem });
                }
            }
        }
    }
}
exports.Helper = Helper;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGVscGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvcmUvaGVscGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDJCQUErRTtBQUMvRSwrQkFBZ0Q7QUFHaEQsd0NBQXVEO0FBRXZELG9DQUFvQztBQUNwQyxtQ0FBb0M7QUFJcEMsTUFBYSxNQUFNO0lBRWYsTUFBTSxDQUFVLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRW5ELE1BQU0sQ0FBQyxhQUFhLENBQUksTUFBUyxFQUFFLE1BQU0sR0FBRyxLQUFLO1FBQzdDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQzthQUNuQixNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDO2FBQ3JDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRTtZQUNYLE1BQU0sTUFBTSxHQUFHLEdBQUcsQ0FBQyxPQUFPLENBQUMsSUFBSSxNQUFNLENBQUMsR0FBRyxHQUFHLE1BQU0sR0FBRyxHQUFHLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFFLENBQUMsQ0FBRSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUM7WUFDdkgsSUFBSyxNQUFjLENBQUUsTUFBTSxDQUFFLEtBQUssU0FBUyxFQUFFLENBQUM7Z0JBQ3pDLE1BQWMsQ0FBRSxNQUFNLENBQUUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFFLEdBQUcsQ0FBRSxDQUFDO1lBQ25ELENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNYLENBQUM7SUFFRCxNQUFNLENBQUMsS0FBSyxDQUFDLDZCQUE2QixDQUFDLE1BQW1C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V0FBVyxDQUFDLENBQUMsQ0FBQztZQUNyRSxNQUFNLFVBQVUsR0FBRyxJQUFBLG1CQUFVLEVBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDdEYsTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsMENBQTBDLEVBQUUsRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFDO1lBRWhGLDBDQUEwQztZQUMxQyxLQUFLLE1BQU0sWUFBWSxJQUFJLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztnQkFDL0MsSUFBSSxPQUFPLFlBQVksS0FBSyxVQUFVLElBQUksWUFBWSxDQUFDLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztvQkFFeEUsTUFBTSxjQUFjLEdBQXNCO3dCQUN0QyxZQUFZLEVBQUUsWUFBWTt3QkFDMUIsUUFBUSxFQUFFLFdBQVc7d0JBQ3JCLFFBQVEsRUFBRSxnQkFBZ0I7d0JBQzFCLFdBQVcsRUFBRSxVQUFVO3FCQUMxQixDQUFDO29CQUVGLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLDBEQUEwRCxFQUFFLEVBQUUsV0FBVyxFQUFFLGdCQUFnQixFQUFFLENBQUMsQ0FBQztvQkFFbkgsZ0JBQWdCLENBQUMsY0FBYyxDQUFDLENBQUM7b0JBQ2pDLE1BQU07Z0JBQ1YsQ0FBQztxQkFBTSxDQUFDO29CQUNKLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLG9EQUFvRCxFQUFFLEVBQUUsWUFBWSxFQUFFLENBQUMsQ0FBQztnQkFDaEcsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO0lBQ0wsQ0FBQzs7QUFsS0wsd0JBbUtDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcmVhZGRpclN5bmMsIGV4aXN0c1N5bmMsIHJlYWRGaWxlLCByZWFkRmlsZVN5bmMsIHN0YXRTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyByZXNvbHZlLCBqb2luLCByZWxhdGl2ZSwgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IEhhbmRsZXJEZXNjcmlwdG9yIGZyb20gXCIuLi9pbnRlcmZhY2VzL2hhbmRsZXItZGVzY3JpcHRvclwiO1xuaW1wb3J0IHsgSUZ3MjRNb2R1bGUgfSBmcm9tIFwiLi9ydW50aW1lL21vZHVsZVwiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyLCBMb2dEdXJhdGlvbiB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBRdWV1ZVByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IGlzU3RyaW5nIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSBcImNyeXB0b1wiO1xuXG5cblxuZXhwb3J0IGNsYXNzIEhlbHBlciB7XG5cbiAgICBzdGF0aWMgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEhlbHBlci5uYW1lKTtcblxuICAgIHN0YXRpYyBoeWRyYXRlQ29uZmlnPFQ+KGNvbmZpZzogVCwgcHJlZml4ID0gXCJBUFBcIikge1xuICAgICAgICBPYmplY3Qua2V5cyhwcm9jZXNzLmVudilcbiAgICAgICAgICAgIC5maWx0ZXIoa2V5ID0+IGtleS5zdGFydHNXaXRoKHByZWZpeCkpXG4gICAgICAgICAgICAuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG5ld0tleSA9IGtleS5yZXBsYWNlKG5ldyBSZWdFeHAoJ14nICsgcHJlZml4ICsgJ18nKSwgJycpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXy4vZywgeCA9PiB4WyAxIF0udG9VcHBlckNhc2UoKSk7XG4gICAgICAgICAgICAgICAgaWYgKChjb25maWcgYXMgYW55KVsgbmV3S2V5IF0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICAoY29uZmlnIGFzIGFueSlbIG5ld0tleSBdID0gcHJvY2Vzcy5lbnZbIGtleSBdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgIH1cblxuICAgIHN0YXRpYyBhc3luYyByZWdpc3RlckNvbnRyb2xsZXJzRnJvbU1vZHVsZShtb2R1bGU6IElGdzI0TW9kdWxlLCBoYW5kbGVyUmVnaXN0cmFyOiAoaGFuZGxlckluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB2b2lkKSB7XG4gICAgICAgIGNvbnN0IGJhc2VQYXRoID0gbW9kdWxlLmdldEJhc2VQYXRoKCk7XG5cbiAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcInJlZ2lzdGVyQ29udHJvbGxlcnNGcm9tTW9kdWxlOjo6IGJhc2UtcGF0aDogXCIgKyBiYXNlUGF0aCk7XG5cbiAgICAgICAgLy8gcmVsYXRpdmUgcGF0aCBmcm9tIHRoZSBwbGFjZSB3aGVyZSB0aGUgc2NyaXB0IGlzIGdldHRpbmcgZXhlY3V0ZWQgaS5lIGluZGV4LnRzIGluIGFwcC1yb290XG4gICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHJlbGF0aXZlKCcuLycsIGJhc2VQYXRoKTtcbiAgICAgICAgY29uc3QgY29udHJvbGxlcnNQYXRoID0gcmVzb2x2ZShyZWxhdGl2ZVBhdGgsIG1vZHVsZS5nZXRDb250cm9sbGVyc0RpcmVjdG9yeSgpKTtcblxuICAgICAgICAvLyBUT0RPOiBzdXBwb3J0IGZvciBjb250cm9sbGVyIHBhdGggcHJlZml4IFsgZS5nLiBtb2R1bGUtbmFtZS9jb250cm9sbGVyLXBhdGggXVxuXG4gICAgICAgIC8vIG1ha2Ugc3VyZSB0aGF0IHRoZSBjb250cm9sbGVyIHBhdGggZXhpc3RzXG4gICAgICAgIGlmIChleGlzdHNTeW5jKGNvbnRyb2xsZXJzUGF0aCkpIHtcblxuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcInJlZ2lzdGVyQ29udHJvbGxlcnNGcm9tTW9kdWxlOjo6IG1vZHVsZS1jb250cm9sbGVycy1wYXRoOiBcIiArIGNvbnRyb2xsZXJzUGF0aCk7XG5cbiAgICAgICAgICAgIEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKGNvbnRyb2xsZXJzUGF0aCwgaGFuZGxlclJlZ2lzdHJhcik7XG5cbiAgICAgICAgfSBlbHNlIHtcblxuICAgICAgICAgICAgSGVscGVyLmxvZ2dlci53YXJuKFwicmVnaXN0ZXJDb250cm9sbGVyc0Zyb21Nb2R1bGU6OjogbW9kdWxlLWNvbnRyb2xsZXJzLXBhdGggZG9lcyBub3QgZXhpc3Q6IFwiICsgY29udHJvbGxlcnNQYXRoKTtcbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgc3RhdGljIGFzeW5jIHJlZ2lzdGVyUXVldWVzRnJvbU1vZHVsZShtb2R1bGU6IElGdzI0TW9kdWxlLCBoYW5kbGVyUmVnaXN0cmFyOiAoaGFuZGxlckluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB2b2lkKSB7XG4gICAgICAgIGNvbnN0IGJhc2VQYXRoID0gbW9kdWxlLmdldEJhc2VQYXRoKCk7XG5cbiAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcInJlZ2lzdGVyUXVldWVzRnJvbU1vZHVsZTo6OiBiYXNlLXBhdGg6IFwiICsgYmFzZVBhdGgpO1xuXG4gICAgICAgIC8vIHJlbGF0aXZlIHBhdGggZnJvbSB0aGUgcGxhY2Ugd2hlcmUgdGhlIHNjcmlwdCBpcyBnZXR0aW5nIGV4ZWN1dGVkIGkuZSBpbmRleC50cyBpbiBhcHAtcm9vdFxuICAgICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSByZWxhdGl2ZSgnLi8nLCBiYXNlUGF0aCk7XG4gICAgICAgIGNvbnN0IHF1ZXVlc1BhdGggPSByZXNvbHZlKHJlbGF0aXZlUGF0aCwgbW9kdWxlLmdldFF1ZXVlc0RpcmVjdG9yeSgpKTtcbiAgICAgICAgY29uc3QgaGFuZGxlcnNQYXRoID0gbW9kdWxlLmdldFF1ZXVlRmlsZU5hbWVzKCk7XG5cbiAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcInJlZ2lzdGVyUXVldWVzRnJvbU1vZHVsZTo6OiBtb2R1bGUtcXVldWVzLXBhdGg6IFwiICsgcXVldWVzUGF0aCk7XG5cbiAgICAgICAgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMocXVldWVzUGF0aCwgaGFuZGxlclJlZ2lzdHJhciwgaGFuZGxlcnNQYXRoKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgYXN5bmMgcmVnaXN0ZXJUYXNrc0Zyb21Nb2R1bGUobW9kdWxlOiBJRncyNE1vZHVsZSwgaGFuZGxlclJlZ2lzdHJhcjogKGhhbmRsZXJJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4gdm9pZCkge1xuICAgICAgICBjb25zdCBiYXNlUGF0aCA9IG1vZHVsZS5nZXRCYXNlUGF0aCgpO1xuXG4gICAgICAgIEhlbHBlci5sb2dnZXIuZGVidWcoXCJyZWdpc3RlclRhc2tzRnJvbU1vZHVsZTo6OiBiYXNlLXBhdGg6IFwiICsgYmFzZVBhdGgpO1xuXG4gICAgICAgIC8vIHJlbGF0aXZlIHBhdGggZnJvbSB0aGUgcGxhY2Ugd2hlcmUgdGhlIHNjcmlwdCBpcyBnZXR0aW5nIGV4ZWN1dGVkIGkuZSBpbmRleC50cyBpbiBhcHAtcm9vdFxuICAgICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSByZWxhdGl2ZSgnLi8nLCBiYXNlUGF0aCk7XG4gICAgICAgIGNvbnN0IHRhc2tzUGF0aCA9IHJlc29sdmUocmVsYXRpdmVQYXRoLCBtb2R1bGUuZ2V0VGFza3NEaXJlY3RvcnkoKSk7XG4gICAgICAgIGNvbnN0IGhhbmRsZXJzUGF0aCA9IG1vZHVsZS5nZXRUYXNrRmlsZU5hbWVzKCk7XG5cbiAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcInJlZ2lzdGVyVGFza3NGcm9tTW9kdWxlOjo6IG1vZHVsZS10YXNrcy1wYXRoOiBcIiArIHRhc2tzUGF0aCk7XG5cbiAgICAgICAgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnModGFza3NQYXRoLCBoYW5kbGVyUmVnaXN0cmFyLCBoYW5kbGVyc1BhdGgpO1xuICAgIH1cblxuICAgIHN0YXRpYyBzY2FuQ29udHJvbGxlclNvdXJjZUZpbGVzRnJvbShkaXJlY3RvcnlQYXRoOiBzdHJpbmcpIHtcbiAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcIlNjYW5uaW5nIFRTIHNvdXJjZSBmaWxlcyBmcm9tIHBhdGg6IFwiLCBkaXJlY3RvcnlQYXRoKTtcbiAgICAgICAgLy8gUmVzb2x2ZSB0aGUgYWJzb2x1dGUgcGF0aFxuICAgICAgICBjb25zdCBzb3VyY2VEaXJlY3RvcnkgPSByZXNvbHZlKGRpcmVjdG9yeVBhdGgpO1xuICAgICAgICAvLyBHZXQgYWxsIHRoZSBmaWxlcyBpbiB0aGUgaGFuZGxlciBkaXJlY3RvcnlcbiAgICAgICAgY29uc3QgYWxsRGlyRmlsZXMgPSByZWFkZGlyU3luYyhzb3VyY2VEaXJlY3RvcnksIHsgcmVjdXJzaXZlOiB0cnVlIH0pIGFzIHN0cmluZ1tdO1xuXG4gICAgICAgIC8vIEZpbHRlciB0aGUgdGVzdCBmaWxlcyBhbmQgb25seSBpbmNsdWRlIHRoZSBzb3VyY2UgZmlsZXNcbiAgICAgICAgLy8gV2UgYWxzbyBsb29rIGZvciBKUyBmaWxlcyBhcyB0aGUgRlcyNC1tb2R1bGVzIGFyZSBjb21waWxlZCB0byBKU1xuICAgICAgICBjb25zdCBzb3VyY2VGaWxlUGF0aHMgPSBhbGxEaXJGaWxlcy5maWx0ZXIoKGZpbGUpID0+IHtcblxuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGZpbGUuZW5kc1dpdGgoXCIuZC50c1wiKSAvLyBpZ25vcmUgVHlwZVNjcmlwdCBkZWNsYXJhdGlvbiBmaWxlc1xuICAgICAgICAgICAgICAgIHx8IGZpbGUuZW5kc1dpdGgoXCIudGVzdC50c1wiKSAvLyBpZ25vcmUgdGVzdCBmaWxlc1xuICAgICAgICAgICAgICAgIHx8IGZpbGUuZW5kc1dpdGgoXCIudGVzdC5qc1wiKSAvLyBpZ25vcmUgdGVzdCBmaWxlc1xuICAgICAgICAgICAgICAgIHx8IGZpbGUuZW5kc1dpdGgoXCIuaW50ZWdyYXRpb24udGVzdC50c1wiKSAvLyBpZ25vcmUgaW50ZWdyYXRpb24gdGVzdCBmaWxlc1xuICAgICAgICAgICAgICAgIHx8IGZpbGUuZW5kc1dpdGgoXCIuaW50ZWdyYXRpb24udGVzdC5qc1wiKSAvLyBpZ25vcmUgaW50ZWdyYXRpb24gdGVzdCBmaWxlc1xuICAgICAgICAgICAgICAgIHx8IGZpbGUuZW5kc1dpdGgoXCIuc3BlYy50c1wiKSAvLyBpZ25vcmUgc3BlYyBmaWxlc1xuICAgICAgICAgICAgICAgIHx8IGZpbGUuZW5kc1dpdGgoXCIuc3BlYy5qc1wiKSAvLyBpZ25vcmUgc3BlYyBmaWxlc1xuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gZmlsZS5lbmRzV2l0aChcIi50c1wiKSB8fCBmaWxlLmVuZHNXaXRoKFwiLmpzXCIpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gc291cmNlRmlsZVBhdGhzO1xuICAgIH1cblxuICAgIHN0YXRpYyBpc0ZpZm9RdWV1ZVByb3BzKHByb3BzOiBRdWV1ZVByb3BzKSB7XG4gICAgICAgIGlmIChwcm9wcy5maWZvKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocHJvcHMuZGVkdXBsaWNhdGlvblNjb3BlKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocHJvcHMuZmlmb1Rocm91Z2hwdXRMaW1pdCkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHByb3BzLmNvbnRlbnRCYXNlZERlZHVwbGljYXRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwcm9wcy5xdWV1ZU5hbWUgJiYgaXNTdHJpbmcocHJvcHMucXVldWVOYW1lKSAmJiBwcm9wcy5xdWV1ZU5hbWUuZW5kc1dpdGgoJy5maWZvJykpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHN0YXRpYyBhc3luYyByZWdpc3RlckhhbmRsZXJzKHBhdGg6IHN0cmluZywgaGFuZGxlclJlZ2lzdHJhcjogKGhhbmRsZXJJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4gdm9pZCwgZmlsZXM6IHN0cmluZ1tdID0gW10pIHtcblxuICAgICAgICBIZWxwZXIubG9nZ2VyLmluZm8oXCJSZWdpc3RlcmluZyBMYW1iZGEgSGFuZGxlcnMgZnJvbTogXCIgKyBwYXRoKTtcbiAgICAgICAgLy8gUmVzb2x2ZSB0aGUgYWJzb2x1dGUgcGF0aFxuICAgICAgICBjb25zdCBoYW5kbGVyRGlyZWN0b3J5ID0gcmVzb2x2ZShwYXRoKTtcblxuICAgICAgICBsZXQgaGFuZGxlclBhdGhzID0gW107XG4gICAgICAgIGlmIChmaWxlcy5sZW5ndGggIT09IDApIHtcbiAgICAgICAgICAgIGhhbmRsZXJQYXRocyA9IGZpbGVzO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRmlsdGVyIHRoZSBmaWxlcyB0byBvbmx5IGluY2x1ZGUgVHlwZVNjcmlwdCBmaWxlc1xuICAgICAgICAgICAgaGFuZGxlclBhdGhzID0gSGVscGVyLnNjYW5Db250cm9sbGVyU291cmNlRmlsZXNGcm9tKHBhdGgpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVnaXN0ZXIgdGhlIGhhbmRsZXJzXG4gICAgICAgIGZvciAoY29uc3QgaGFuZGxlclBhdGggb2YgaGFuZGxlclBhdGhzKSB7XG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwiUmVnaXN0ZXJpbmcgTGFtYmRhIEhhbmRsZXJzIGZyb20gaGFuZGxlclBhdGg6IFwiICsgaGFuZGxlclBhdGgpO1xuICAgICAgICAgICAgLy8gRHluYW1pY2FsbHkgaW1wb3J0IHRoZSBjb250cm9sbGVyIGZpbGVcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IGF3YWl0IGltcG9ydChqb2luKGhhbmRsZXJEaXJlY3RvcnksIGhhbmRsZXJQYXRoKSk7XG4gICAgICAgICAgICBjb25zdCBmaWxlQnVmZmVyID0gcmVhZEZpbGVTeW5jKGpvaW4oaGFuZGxlckRpcmVjdG9yeSwgaGFuZGxlclBhdGgpKTtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZUhhc2ggPSBjcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoSlNPTi5zdHJpbmdpZnkoZmlsZUJ1ZmZlcikpLmRpZ2VzdCgnaGV4Jyk7XG4gICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwiUmVnaXN0ZXJpbmcgTGFtYmRhIEhhbmRsZXJzIG1vZHVsZUhhc2g6IFwiLCB7IG1vZHVsZUhhc2ggfSk7XG5cbiAgICAgICAgICAgIC8vIEZpbmQgYW5kIGluc3RhbnRpYXRlIGNvbnRyb2xsZXIgY2xhc3Nlc1xuICAgICAgICAgICAgZm9yIChjb25zdCBleHBvcnRlZEl0ZW0gb2YgT2JqZWN0LnZhbHVlcyhtb2R1bGUpKSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRlZEl0ZW0gPT09IFwiZnVuY3Rpb25cIiAmJiBleHBvcnRlZEl0ZW0ubmFtZSAhPT0gXCJoYW5kbGVyXCIpIHtcblxuICAgICAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50SGFuZGxlcjogSGFuZGxlckRlc2NyaXB0b3IgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYW5kbGVyQ2xhc3M6IGV4cG9ydGVkSXRlbSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBoYW5kbGVyUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVQYXRoOiBoYW5kbGVyRGlyZWN0b3J5LFxuICAgICAgICAgICAgICAgICAgICAgICAgaGFuZGxlckhhc2g6IG1vZHVsZUhhc2hcbiAgICAgICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgICAgICBIZWxwZXIubG9nZ2VyLmRlYnVnKFwiUmVnaXN0ZXJpbmcgTGFtYmRhIEhhbmRsZXJzIHJlZ2lzdGVyaW5nIGN1cnJlbnRIYW5kbGVyOiBcIiwgeyBoYW5kbGVyUGF0aCwgaGFuZGxlckRpcmVjdG9yeSB9KTtcblxuICAgICAgICAgICAgICAgICAgICBoYW5kbGVyUmVnaXN0cmFyKGN1cnJlbnRIYW5kbGVyKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVyLmxvZ2dlci5kZWJ1ZyhcIlJlZ2lzdGVyaW5nIExhbWJkYSBIYW5kbGVycyBpZ25vcmVkIGV4cG9ydGVkSXRlbTogXCIsIHsgZXhwb3J0ZWRJdGVtIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn0iXX0=