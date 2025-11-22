"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Application = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const fw24_1 = require("./core/fw24");
const entity_ui_config_gen_1 = require("./ui-config-gen/entity-ui-config.gen");
const logging_1 = require("./logging");
const constructs_1 = require("./constructs");
const utils_1 = require("./utils");
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
class Application {
    logger;
    mainStack;
    fw24;
    uiConfigGen;
    constructs;
    modules;
    processedConstructs = new Map();
    resourceConstructMaxConcurrency = 10;
    resourceConstructCurrentConcurrency = 0;
    constructor(config = {}) {
        this.logger = (0, logging_1.createLogger)([Application.name, config.name, config.environment].join('-'));
        this.logger.info("Initializing fw24 infrastructure...");
        this.fw24 = fw24_1.Fw24.getInstance();
        this.uiConfigGen = new entity_ui_config_gen_1.EntityUIConfigGen();
        this.fw24.setConfig(config);
        if (config.environmentVariables) {
            Object.entries(config.environmentVariables).forEach(([key, value]) => {
                this.fw24.setEnvironmentVariable(key, value);
            });
        }
        if (config.globalEnvironmentVariables) {
            Object.entries(config.globalEnvironmentVariables).forEach(([key, value]) => {
                this.fw24.setGlobalEnvironmentVariable(key, value);
            });
        }
        // ensure there's a log-level set in the fw24 scope so that the constructs can ask for this value
        // this's only the global value, and can be overridden by each lambda function.
        if (!this.fw24.hasEnvironmentVariable('LOG_LEVEL')) {
            this.fw24.setEnvironmentVariable('LOG_LEVEL', process.env.LOG_LEVEL || 'INFO');
        }
        this.constructs = new Map();
        this.modules = new Map();
        // initialize the main stack
        const app = new aws_cdk_lib_1.App();
        this.fw24.setApp(app);
    }
    use(construct) {
        this.registerConstruct(construct);
        return this;
    }
    useModule(module) {
        this.logger.debug("Called UseModule with module: ", { moduleName: module.getName() });
        if (this.modules.has(module.getName())) {
            throw new Error(`Module with name ${module.getName()} is already registered.`);
        }
        this.modules.set(module.getName(), module);
        for (const [constructName, construct] of module.getConstructs()) {
            this.logger.info("UseModule: Registering construct: ", constructName, module.getDependencies(), construct.dependencies);
            construct.dependencies = module.getDependencies();
            this.registerConstruct(construct, constructName);
        }
        return this;
    }
    async run() {
        this.logger.info("Running fw24 infrastructure...");
        // Create default fw24 runtime layer (ONLY runtime code, not infrastructure)
        // This layer is automatically attached to all Lambda functions
        // It's NOT an entry package - it's just available for imports
        this.logger.info("Building fw24 runtime layer...");
        const fw24Layer = new constructs_1.LayerConstruct([{
                mode: 'BUILD_AND_PACKAGE',
                // Bundle the fw24 runtime source (has imports, needs bundling with esbuild)
                sourcePath: './node_modules/@ten24group/fw24/dist/package/layer/fw24.js',
                packagePath: '@ten24group/fw24',
                priority: 0,
                // Output to application's dist/layers directory, not framework's directory
                distDirectory: (0, node_path_1.join)(process.cwd(), 'dist/layers'),
                buildOptions: {
                    sourcemap: true,
                    external: ['@aws-sdk', '@smithy'] // AWS SDK is provided by Lambda runtime
                }
            }]);
        fw24Layer.construct();
        // *** order is important here, modules need to be processed first, before constructs ***
        this.processModules();
        const disableUIConfigGen = fw24_1.Fw24.getInstance().getConfig().disableUIConfigGen;
        if (!disableUIConfigGen) {
            await this.uiConfigGen.run();
        }
        // configure a build command like in package.json to only generate the ui config
        // "ui:gen": "UI_GEN_ONLY=true env-cmd -f .env.local ts-node src/index.ts"
        // this is useful for generating the ui config during development
        if (process.env.UI_GEN_ONLY === 'true') {
            this.logger.info('UI config generation complete. Exiting.');
            return;
        }
        const totalConstructs = this.constructs.size;
        this.logger.info(`${'='.repeat(60)}`);
        this.logger.info(`🚀 Building ${totalConstructs} construct(s)...`);
        this.logger.info(`${'='.repeat(60)}\n`);
        await this.constructAllResources();
        this.logger.info(`${'='.repeat(60)}`);
        this.logger.info(`✅ All constructs completed successfully`);
        this.logger.info(`${'='.repeat(60)}\n`);
    }
    registerConstruct(construct, name) {
        let constructName = name || construct.name;
        if (this.constructs.has(constructName)) {
            // handle multiple constructs of same type
            const newConstructName = constructName.concat('-', (0, node_crypto_1.randomUUID)());
            this.logger.info(`Construct with name ${constructName} is already registered, renaming to ${newConstructName}`);
            constructName = newConstructName;
        }
        this.constructs.set(constructName, construct);
        this.fw24.addConstruct(construct);
    }
    processModules() {
        for (const [moduleName, module] of this.modules) {
            this.fw24.addModule(moduleName, module);
        }
    }
    constructAllResources() {
        const allConstructs = Array.from(this.constructs.keys()).map(constructName => this.constructResources(constructName));
        return Promise.all(allConstructs);
    }
    async constructResources(constructName) {
        const construct = this.constructs.get(constructName);
        if (!construct) {
            throw new Error(`Construct ${constructName} not found`);
        }
        while (this.resourceConstructCurrentConcurrency >= this.resourceConstructMaxConcurrency) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Throttle if concurrency limit is reached
        }
        // Only log if there are actual dependencies
        if (construct.dependencies && construct.dependencies.length > 0) {
            this.logger.debug(`⏳ ${constructName}: Waiting for dependencies: ${construct.dependencies.join(', ')}`);
        }
        // Wait for dependencies to resolve
        await this.waitForDependencies(construct.dependencies, constructName);
        this.logger.info(`🔨 Building ${constructName}...`);
        this.resourceConstructCurrentConcurrency++;
        const timer = utils_1.Timer.start();
        const constructCompletionPromise = (async () => {
            try {
                await construct.construct();
                this.logger.info(`✅ ${constructName} completed in ${timer.elapsedSeconds()}`);
            }
            catch (error) {
                this.logger.error(`❌ ${constructName} failed:`, error);
                throw error; // Re-throw to ensure deployment fails
            }
            finally {
                this.resourceConstructCurrentConcurrency--;
            }
        })();
        this.processedConstructs.set(constructName, constructCompletionPromise);
        return constructCompletionPromise;
    }
    async waitForDependencies(dependencies, constructName) {
        if (!dependencies || dependencies.length === 0) {
            return;
        }
        const promises = dependencies.map(dependency => {
            // if dependency construct does not exists in the construct list, mark it as processed
            if (!this.constructs.has(dependency)) {
                this.logger.debug(`${constructName}: Dependency ${dependency} not registered (optional dependency)`);
                this.processedConstructs.set(dependency, Promise.resolve());
            }
            if (!this.processedConstructs.has(dependency)) {
                // If dependency not scheduled yet, listen for its addition
                return new Promise((resolve, reject) => {
                    const interval = setInterval(() => {
                        if (this.processedConstructs.has(dependency)) {
                            clearInterval(interval);
                            this.processedConstructs.get(dependency).then(resolve, reject);
                        }
                    }, 100); // Check every 100ms
                });
            }
            return this.processedConstructs.get(dependency);
        });
        await Promise.all(promises);
    }
}
exports.Application = Application;
__decorate([
    (0, logging_1.LogDuration)()
], Application.prototype, "run", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsNkNBQXlDO0FBQ3pDLHNDQUFtQztBQUluQywrRUFBeUU7QUFDekUsdUNBQStEO0FBQy9ELDZDQUE4QztBQUM5QyxtQ0FBZ0M7QUFDaEMsNkNBQXlDO0FBQ3pDLHlDQUE2QztBQUU3QyxNQUFhLFdBQVc7SUFDWCxNQUFNLENBQVU7SUFDekIsU0FBUyxDQUFTO0lBRUYsSUFBSSxDQUFPO0lBQ1gsV0FBVyxDQUFvQjtJQUM5QixVQUFVLENBQTZCO0lBQ3ZDLE9BQU8sQ0FBMkI7SUFDbEMsbUJBQW1CLEdBQStCLElBQUksR0FBRyxFQUFFLENBQUM7SUFDNUQsK0JBQStCLEdBQVcsRUFBRSxDQUFDO0lBQ3RELG1DQUFtQyxHQUFHLENBQUMsQ0FBQztJQUVoRCxZQUFZLFNBQTZCLEVBQUU7UUFDdkMsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsQ0FBRSxXQUFXLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLFdBQVcsQ0FBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBRTVGLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHFDQUFxQyxDQUFDLENBQUM7UUFFeEQsSUFBSSxDQUFDLElBQUksR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDL0IsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLHdDQUFpQixFQUFFLENBQUM7UUFDM0MsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFNUIsSUFBSSxNQUFNLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztZQUM5QixNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLE9BQU8sQ0FB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Y2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IElBcHBsaWNhdGlvbkNvbmZpZyB9IGZyb20gXCIuL2ludGVyZmFjZXMvY29uZmlnXCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0IH0gZnJvbSBcIi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IElGdzI0TW9kdWxlIH0gZnJvbSBcIi4vY29yZS9ydW50aW1lL21vZHVsZVwiO1xuaW1wb3J0IHsgRW50aXR5VUlDb25maWdHZW4gfSBmcm9tIFwiLi91aS1jb25maWctZ2VuL2VudGl0eS11aS1jb25maWcuZ2VuXCI7XG5pbXBvcnQgeyBJTG9nZ2VyLCBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyBUaW1lciB9IGZyb20gXCIuL3V0aWxzXCI7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnbm9kZTpjcnlwdG8nO1xuaW1wb3J0IHsgam9pbiBhcyBwYXRoSm9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBjbGFzcyBBcHBsaWNhdGlvbiB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyOiBJTG9nZ2VyO1xuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgcHVibGljIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQ7XG4gICAgcHVibGljIHJlYWRvbmx5IHVpQ29uZmlnR2VuOiBFbnRpdHlVSUNvbmZpZ0dlbjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbnN0cnVjdHM6IE1hcDxzdHJpbmcsIEZXMjRDb25zdHJ1Y3Q+O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgbW9kdWxlczogTWFwPHN0cmluZywgSUZ3MjRNb2R1bGU+O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgcHJvY2Vzc2VkQ29uc3RydWN0czogTWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj4gPSBuZXcgTWFwKCk7XG4gICAgcHJpdmF0ZSByZWFkb25seSByZXNvdXJjZUNvbnN0cnVjdE1heENvbmN1cnJlbmN5OiBudW1iZXIgPSAxMDtcbiAgICBwcml2YXRlIHJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5ID0gMDtcblxuICAgIGNvbnN0cnVjdG9yKGNvbmZpZzogSUFwcGxpY2F0aW9uQ29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dnZXIgPSBjcmVhdGVMb2dnZXIoWyBBcHBsaWNhdGlvbi5uYW1lLCBjb25maWcubmFtZSwgY29uZmlnLmVudmlyb25tZW50IF0uam9pbignLScpKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiSW5pdGlhbGl6aW5nIGZ3MjQgaW5mcmFzdHJ1Y3R1cmUuLi5cIik7XG5cbiAgICAgICAgdGhpcy5mdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgICAgICB0aGlzLnVpQ29uZmlnR2VuID0gbmV3IEVudGl0eVVJQ29uZmlnR2VuKCk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25maWcoY29uZmlnKTtcblxuICAgICAgICBpZiAoY29uZmlnLmVudmlyb25tZW50VmFyaWFibGVzKSB7XG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhjb25maWcuZW52aXJvbm1lbnRWYXJpYWJsZXMpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5nbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcykge1xuICAgICAgICAgICAgT2JqZWN0LmVudHJpZXMoY29uZmlnLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKS5mb3JFYWNoKChbIGtleSwgdmFsdWUgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGVuc3VyZSB0aGVyZSdzIGEgbG9nLWxldmVsIHNldCBpbiB0aGUgZncyNCBzY29wZSBzbyB0aGF0IHRoZSBjb25zdHJ1Y3RzIGNhbiBhc2sgZm9yIHRoaXMgdmFsdWVcbiAgICAgICAgLy8gdGhpcydzIG9ubHkgdGhlIGdsb2JhbCB2YWx1ZSwgYW5kIGNhbiBiZSBvdmVycmlkZGVuIGJ5IGVhY2ggbGFtYmRhIGZ1bmN0aW9uLlxuICAgICAgICBpZiAoIXRoaXMuZncyNC5oYXNFbnZpcm9ubWVudFZhcmlhYmxlKCdMT0dfTEVWRUwnKSkge1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcsIHByb2Nlc3MuZW52LkxPR19MRVZFTCB8fCAnSU5GTycpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5jb25zdHJ1Y3RzID0gbmV3IE1hcCgpO1xuICAgICAgICB0aGlzLm1vZHVsZXMgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gaW5pdGlhbGl6ZSB0aGUgbWFpbiBzdGFja1xuICAgICAgICBjb25zdCBhcHAgPSBuZXcgQXBwKCk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRBcHAoYXBwKTtcblxuICAgIH1cblxuICAgIHB1YmxpYyB1c2UoY29uc3RydWN0OiBGVzI0Q29uc3RydWN0KTogdGhpcyB7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0KTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgcHVibGljIHVzZU1vZHVsZShtb2R1bGU6IElGdzI0TW9kdWxlKTogdGhpcyB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ2FsbGVkIFVzZU1vZHVsZSB3aXRoIG1vZHVsZTogXCIsIHsgbW9kdWxlTmFtZTogbW9kdWxlLmdldE5hbWUoKSB9KTtcblxuICAgICAgICBpZiAodGhpcy5tb2R1bGVzLmhhcyhtb2R1bGUuZ2V0TmFtZSgpKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2R1bGUgd2l0aCBuYW1lICR7bW9kdWxlLmdldE5hbWUoKX0gaXMgYWxyZWFkeSByZWdpc3RlcmVkLmApO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5tb2R1bGVzLnNldChtb2R1bGUuZ2V0TmFtZSgpLCBtb2R1bGUpO1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3QgXSBvZiBtb2R1bGUuZ2V0Q29uc3RydWN0cygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiVXNlTW9kdWxlOiBSZWdpc3RlcmluZyBjb25zdHJ1Y3Q6IFwiLCBjb25zdHJ1Y3ROYW1lLCBtb2R1bGUuZ2V0RGVwZW5kZW5jaWVzKCksIGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgY29uc3RydWN0LmRlcGVuZGVuY2llcyA9IG1vZHVsZS5nZXREZXBlbmRlbmNpZXMoKTtcbiAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0LCBjb25zdHJ1Y3ROYW1lKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHVibGljIGFzeW5jIHJ1bigpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlJ1bm5pbmcgZncyNCBpbmZyYXN0cnVjdHVyZS4uLlwiKTtcblxuICAgICAgICAvLyBDcmVhdGUgZGVmYXVsdCBmdzI0IHJ1bnRpbWUgbGF5ZXIgKE9OTFkgcnVudGltZSBjb2RlLCBub3QgaW5mcmFzdHJ1Y3R1cmUpXG4gICAgICAgIC8vIFRoaXMgbGF5ZXIgaXMgYXV0b21hdGljYWxseSBhdHRhY2hlZCB0byBhbGwgTGFtYmRhIGZ1bmN0aW9uc1xuICAgICAgICAvLyBJdCdzIE5PVCBhbiBlbnRyeSBwYWNrYWdlIC0gaXQncyBqdXN0IGF2YWlsYWJsZSBmb3IgaW1wb3J0c1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQnVpbGRpbmcgZncyNCBydW50aW1lIGxheWVyLi4uXCIpO1xuICAgICAgICBjb25zdCBmdzI0TGF5ZXIgPSBuZXcgTGF5ZXJDb25zdHJ1Y3QoWyB7XG4gICAgICAgICAgICBtb2RlOiAnQlVJTERfQU5EX1BBQ0tBR0UnLFxuICAgICAgICAgICAgLy8gQnVuZGxlIHRoZSBmdzI0IHJ1bnRpbWUgc291cmNlIChoYXMgaW1wb3J0cywgbmVlZHMgYnVuZGxpbmcgd2l0aCBlc2J1aWxkKVxuICAgICAgICAgICAgc291cmNlUGF0aDogJy4vbm9kZV9tb2R1bGVzL0B0ZW4yNGdyb3VwL2Z3MjQvZGlzdC9wYWNrYWdlL2xheWVyL2Z3MjQuanMnLFxuICAgICAgICAgICAgcGFja2FnZVBhdGg6ICdAdGVuMjRncm91cC9mdzI0JyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAwLFxuICAgICAgICAgICAgLy8gT3V0cHV0IHRvIGFwcGxpY2F0aW9uJ3MgZGlzdC9sYXllcnMgZGlyZWN0b3J5LCBub3QgZnJhbWV3b3JrJ3MgZGlyZWN0b3J5XG4gICAgICAgICAgICBkaXN0RGlyZWN0b3J5OiBwYXRoSm9pbihwcm9jZXNzLmN3ZCgpLCAnZGlzdC9sYXllcnMnKSxcbiAgICAgICAgICAgIGJ1aWxkT3B0aW9uczoge1xuICAgICAgICAgICAgICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBleHRlcm5hbDogWydAYXdzLXNkaycsICdAc21pdGh5J10gLy8gQVdTIFNESyBpcyBwcm92aWRlZCBieSBMYW1iZGEgcnVudGltZVxuICAgICAgICAgICAgfVxuICAgICAgICB9IF0pO1xuICAgICAgICBmdzI0TGF5ZXIuY29uc3RydWN0KCk7XG5cbiAgICAgICAgLy8gKioqIG9yZGVyIGlzIGltcG9ydGFudCBoZXJlLCBtb2R1bGVzIG5lZWQgdG8gYmUgcHJvY2Vzc2VkIGZpcnN0LCBiZWZvcmUgY29uc3RydWN0cyAqKipcbiAgICAgICAgdGhpcy5wcm9jZXNzTW9kdWxlcygpO1xuXG4gICAgICAgIGNvbnN0IGRpc2FibGVVSUNvbmZpZ0dlbiA9IEZ3MjQuZ2V0SW5zdGFuY2UoKS5nZXRDb25maWcoKS5kaXNhYmxlVUlDb25maWdHZW47XG5cbiAgICAgICAgaWYgKCFkaXNhYmxlVUlDb25maWdHZW4pIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMudWlDb25maWdHZW4ucnVuKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjb25maWd1cmUgYSBidWlsZCBjb21tYW5kIGxpa2UgaW4gcGFja2FnZS5qc29uIHRvIG9ubHkgZ2VuZXJhdGUgdGhlIHVpIGNvbmZpZ1xuICAgICAgICAvLyBcInVpOmdlblwiOiBcIlVJX0dFTl9PTkxZPXRydWUgZW52LWNtZCAtZiAuZW52LmxvY2FsIHRzLW5vZGUgc3JjL2luZGV4LnRzXCJcbiAgICAgICAgLy8gdGhpcyBpcyB1c2VmdWwgZm9yIGdlbmVyYXRpbmcgdGhlIHVpIGNvbmZpZyBkdXJpbmcgZGV2ZWxvcG1lbnRcbiAgICAgICAgaWYgKHByb2Nlc3MuZW52LlVJX0dFTl9PTkxZID09PSAndHJ1ZScpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1VJIGNvbmZpZyBnZW5lcmF0aW9uIGNvbXBsZXRlLiBFeGl0aW5nLicpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdG90YWxDb25zdHJ1Y3RzID0gdGhpcy5jb25zdHJ1Y3RzLnNpemU7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCR7Jz0nLnJlcGVhdCg2MCl9YCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCfmoAgQnVpbGRpbmcgJHt0b3RhbENvbnN0cnVjdHN9IGNvbnN0cnVjdChzKS4uLmApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfVxcbmApO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuY29uc3RydWN0QWxsUmVzb3VyY2VzKClcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfWApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgQWxsIGNvbnN0cnVjdHMgY29tcGxldGVkIHN1Y2Nlc3NmdWxseWApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfVxcbmApO1xuICAgIH1cblxuXG4gICAgcHJpdmF0ZSByZWdpc3RlckNvbnN0cnVjdChjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QsIG5hbWU/OiBzdHJpbmcpIHtcbiAgICAgICAgbGV0IGNvbnN0cnVjdE5hbWUgPSBuYW1lIHx8IGNvbnN0cnVjdC5uYW1lO1xuICAgICAgICBpZiAodGhpcy5jb25zdHJ1Y3RzLmhhcyhjb25zdHJ1Y3ROYW1lKSkge1xuICAgICAgICAgICAgLy8gaGFuZGxlIG11bHRpcGxlIGNvbnN0cnVjdHMgb2Ygc2FtZSB0eXBlXG4gICAgICAgICAgICBjb25zdCBuZXdDb25zdHJ1Y3ROYW1lID0gY29uc3RydWN0TmFtZS5jb25jYXQoJy0nLCByYW5kb21VVUlEKCkpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29uc3RydWN0IHdpdGggbmFtZSAke2NvbnN0cnVjdE5hbWV9IGlzIGFscmVhZHkgcmVnaXN0ZXJlZCwgcmVuYW1pbmcgdG8gJHtuZXdDb25zdHJ1Y3ROYW1lfWApO1xuICAgICAgICAgICAgY29uc3RydWN0TmFtZSA9IG5ld0NvbnN0cnVjdE5hbWU7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5jb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3QpO1xuICAgICAgICB0aGlzLmZ3MjQuYWRkQ29uc3RydWN0KGNvbnN0cnVjdCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBwcm9jZXNzTW9kdWxlcygpIHtcbiAgICAgICAgZm9yIChjb25zdCBbIG1vZHVsZU5hbWUsIG1vZHVsZSBdIG9mIHRoaXMubW9kdWxlcykge1xuICAgICAgICAgICAgdGhpcy5mdzI0LmFkZE1vZHVsZShtb2R1bGVOYW1lLCBtb2R1bGUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjb25zdHJ1Y3RBbGxSZXNvdXJjZXMoKSB7XG4gICAgICAgIGNvbnN0IGFsbENvbnN0cnVjdHMgPSBBcnJheS5mcm9tKHRoaXMuY29uc3RydWN0cy5rZXlzKCkpLm1hcChjb25zdHJ1Y3ROYW1lID0+IHRoaXMuY29uc3RydWN0UmVzb3VyY2VzKGNvbnN0cnVjdE5hbWUpKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKGFsbENvbnN0cnVjdHMpO1xuICAgIH1cblxuICAgIGFzeW5jIGNvbnN0cnVjdFJlc291cmNlcyhjb25zdHJ1Y3ROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgY29uc3RydWN0ID0gdGhpcy5jb25zdHJ1Y3RzLmdldChjb25zdHJ1Y3ROYW1lKTtcbiAgICAgICAgaWYgKCFjb25zdHJ1Y3QpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29uc3RydWN0ICR7Y29uc3RydWN0TmFtZX0gbm90IGZvdW5kYCk7XG4gICAgICAgIH1cblxuICAgICAgICB3aGlsZSAodGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSA+PSB0aGlzLnJlc291cmNlQ29uc3RydWN0TWF4Q29uY3VycmVuY3kpIHtcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDApKTsgLy8gVGhyb3R0bGUgaWYgY29uY3VycmVuY3kgbGltaXQgaXMgcmVhY2hlZFxuICAgICAgICB9XG5cbiAgICAgICAgLy8gT25seSBsb2cgaWYgdGhlcmUgYXJlIGFjdHVhbCBkZXBlbmRlbmNpZXNcbiAgICAgICAgaWYgKGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMgJiYgY29uc3RydWN0LmRlcGVuZGVuY2llcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhg4o+zICR7Y29uc3RydWN0TmFtZX06IFdhaXRpbmcgZm9yIGRlcGVuZGVuY2llczogJHtjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBXYWl0IGZvciBkZXBlbmRlbmNpZXMgdG8gcmVzb2x2ZVxuICAgICAgICBhd2FpdCB0aGlzLndhaXRGb3JEZXBlbmRlbmNpZXMoY29uc3RydWN0LmRlcGVuZGVuY2llcywgY29uc3RydWN0TmFtZSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg8J+UqCBCdWlsZGluZyAke2NvbnN0cnVjdE5hbWV9Li4uYCk7XG5cbiAgICAgICAgdGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSsrO1xuICAgICAgICBjb25zdCB0aW1lciA9IFRpbWVyLnN0YXJ0KCk7XG4gICAgICAgIGNvbnN0IGNvbnN0cnVjdENvbXBsZXRpb25Qcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgY29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSAke2NvbnN0cnVjdE5hbWV9IGNvbXBsZXRlZCBpbiAke3RpbWVyLmVsYXBzZWRTZWNvbmRzKCl9YCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGDinYwgJHtjb25zdHJ1Y3ROYW1lfSBmYWlsZWQ6YCwgZXJyb3IpO1xuICAgICAgICAgICAgICAgIHRocm93IGVycm9yOyAvLyBSZS10aHJvdyB0byBlbnN1cmUgZGVwbG95bWVudCBmYWlsc1xuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5LS07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKCk7XG5cbiAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZSk7XG4gICAgICAgIHJldHVybiBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHdhaXRGb3JEZXBlbmRlbmNpZXMoZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSwgY29uc3RydWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghZGVwZW5kZW5jaWVzIHx8IGRlcGVuZGVuY2llcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gZGVwZW5kZW5jaWVzLm1hcChkZXBlbmRlbmN5ID0+IHtcbiAgICAgICAgICAgIC8vIGlmIGRlcGVuZGVuY3kgY29uc3RydWN0IGRvZXMgbm90IGV4aXN0cyBpbiB0aGUgY29uc3RydWN0IGxpc3QsIG1hcmsgaXQgYXMgcHJvY2Vzc2VkXG4gICAgICAgICAgICBpZiAoIXRoaXMuY29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtjb25zdHJ1Y3ROYW1lfTogRGVwZW5kZW5jeSAke2RlcGVuZGVuY3l9IG5vdCByZWdpc3RlcmVkIChvcHRpb25hbCBkZXBlbmRlbmN5KWApO1xuICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5zZXQoZGVwZW5kZW5jeSwgUHJvbWlzZS5yZXNvbHZlKCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCF0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgLy8gSWYgZGVwZW5kZW5jeSBub3Qgc2NoZWR1bGVkIHlldCwgbGlzdGVuIGZvciBpdHMgYWRkaXRpb25cbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJJbnRlcnZhbChpbnRlcnZhbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmdldChkZXBlbmRlbmN5KSEudGhlbihyZXNvbHZlLCByZWplY3QpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LCAxMDApOyAvLyBDaGVjayBldmVyeSAxMDBtc1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5nZXQoZGVwZW5kZW5jeSkhO1xuICAgICAgICB9KTtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICAgIH1cblxufVxuIl19