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
                    external: ['@aws-sdk', '@smithy'] // AWS SDK is NOT provided by Lambda runtime
                },
                isEntryPackage: false,
            }]);
        await fw24Layer.construct();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsNkNBQXlDO0FBQ3pDLHNDQUFtQztBQUluQywrRUFBeUU7QUFDekUsdUNBQStEO0FBQy9ELDZDQUE4QztBQUM5QyxtQ0FBZ0M7QUFDaEMsNkNBQXlDO0FBQ3pDLHlDQUE2QztBQUU3QyxNQUFhLFdBQVc7SUFDWCxNQUFNLENBQVU7SUFDekIsU0FBUyxDQUFTO0lBRUYsSUFBSSxDQUFPO0lBQ1gsV0FBVyxDQUFvQjtJQUM5QixVQUFVLENBQTZCO0lBQ3ZDLE9BQU8sQ0FBMkI7SUFDbEMsbUJBQW1CLEdBQStCLElBQUksR0FBRyxFQUFFLENBQUM7SUFDNUQsK0JBQStCLEdBQVcsRUFBRSxDQUFDO0lBQ3RELG1DQUFtQyxHQUFHLENBQUMsQ0FBQztJQUVoRCxZQUFZLFNBQTZCLEVBQUU7UUFDdkMsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsQ0FBRSxXQUFXLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLFdBQVcsQ0FBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBRTVGLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHFDQUFxQyxDQUFDLENBQUM7UUFFeEQsSUFBSSxDQUFDLElBQUksR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDL0IsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLHdDQUFpQixFQUFFLENBQUM7UUFDM0MsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFNUIsSUFBSSxNQUFNLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztZQUM5QixNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLE9BQU8sQ0FB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b250ZW50IjpbImltcG9ydCB7IEFwcCwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IElBcHBsaWNhdGlvbkNvbmZpZyB9IGZyb20gXCIuL2ludGVyZmFjZXMvY29uZmlnXCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0IH0gZnJvbSBcIi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IElGdzI0TW9kdWxlIH0gZnJvbSBcIi4vY29yZS9ydW50aW1lL21vZHVsZVwiO1xuaW1wb3J0IHsgRW50aXR5VUlDb25maWdHZW4gfSBmcm9tIFwiLi91aS1jb25maWctZ2VuL2VudGl0eS11aS1jb25maWcuZ2VuXCI7XG5pbXBvcnQgeyBJTG9nZ2VyLCBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyBUaW1lciB9IGZyb20gXCIuL3V0aWxzXCI7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnbm9kZTpjcnlwdG8nO1xuaW1wb3J0IHsgam9pbiBhcyBwYXRoSm9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBjbGFzcyBBcHBsaWNhdGlvbiB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyOiBJTG9nZ2VyO1xuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgcHVibGljIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQ7XG4gICAgcHVibGljIHJlYWRvbmx5IHVpQ29uZmlnR2VuOiBFbnRpdHlVSUNvbmZpZ0dlbjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbnN0cnVjdHM6IE1hcDxzdHJpbmcsIEZXMjRDb25zdHJ1Y3Q+O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgbW9kdWxlczogTWFwPHN0cmluZywgSUZ3MjRNb2R1bGU+O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgcHJvY2Vzc2VkQ29uc3RydWN0czogTWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj4gPSBuZXcgTWFwKCk7XG4gICAgcHJpdmF0ZSByZWFkb25seSByZXNvdXJjZUNvbnN0cnVjdE1heENvbmN1cnJlbmN5OiBudW1iZXIgPSAxMDtcbiAgICBwcml2YXRlIHJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5ID0gMDtcblxuICAgIGNvbnN0cnVjdG9yKGNvbmZpZzogSUFwcGxpY2F0aW9uQ29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dnZXIgPSBjcmVhdGVMb2dnZXIoWyBBcHBsaWNhdGlvbi5uYW1lLCBjb25maWcubmFtZSwgY29uZmlnLmVudmlyb25tZW50IF0uam9pbignLScpKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiSW5pdGlhbGl6aW5nIGZ3MjQgaW5mcmFzdHJ1Y3R1cmUuLi5cIik7XG5cbiAgICAgICAgdGhpcy5mdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgICAgICB0aGlzLnVpQ29uZmlnR2VuID0gbmV3IEVudGl0eVVJQ29uZmlnR2VuKCk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25maWcoY29uZmlnKTtcblxuICAgICAgICBpZiAoY29uZmlnLmVudmlyb25tZW50VmFyaWFibGVzKSB7XG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhjb25maWcuZW52aXJvbm1lbnRWYXJpYWJsZXMpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5nbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcykge1xuICAgICAgICAgICAgT2JqZWN0LmVudHJpZXMoY29uZmlnLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKS5mb3JFYWNoKChbIGtleSwgdmFsdWUgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGVuc3VyZSB0aGVyZSdzIGEgbG9nLWxldmVsIHNldCBpbiB0aGUgZncyNCBzY29wZSBzbyB0aGF0IHRoZSBjb25zdHJ1Y3RzIGNhbiBhc2sgZm9yIHRoaXMgdmFsdWVcbiAgICAgICAgLy8gdGhpcydzIG9ubHkgdGhlIGdsb2JhbCB2YWx1ZSwgYW5kIGNhbiBiZSBvdmVycmlkZGVuIGJ5IGVhY2ggbGFtYmRhIGZ1bmN0aW9uLlxuICAgICAgICBpZiAoIXRoaXMuZncyNC5oYXNFbnZpcm9ubWVudFZhcmlhYmxlKCdMT0dfTEVWRUwnKSkge1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcsIHByb2Nlc3MuZW52LkxPR19MRVZFTCB8fCAnSU5GTycpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5jb25zdHJ1Y3RzID0gbmV3IE1hcCgpO1xuICAgICAgICB0aGlzLm1vZHVsZXMgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gaW5pdGlhbGl6ZSB0aGUgbWFpbiBzdGFja1xuICAgICAgICBjb25zdCBhcHAgPSBuZXcgQXBwKCk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRBcHAoYXBwKTtcblxuICAgIH1cblxuICAgIHB1YmxpYyB1c2UoY29uc3RydWN0OiBGVzI0Q29uc3RydWN0KTogdGhpcyB7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0KTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgcHVibGljIHVzZU1vZHVsZShtb2R1bGU6IElGdzI0TW9kdWxlKTogdGhpcyB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ2FsbGVkIFVzZU1vZHVsZSB3aXRoIG1vZHVsZTogXCIsIHsgbW9kdWxlTmFtZTogbW9kdWxlLmdldE5hbWUoKSB9KTtcblxuICAgICAgICBpZiAodGhpcy5tb2R1bGVzLmhhcyhtb2R1bGUuZ2V0TmFtZSgpKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2R1bGUgd2l0aCBuYW1lICR7bW9kdWxlLmdldE5hbWUoKX0gaXMgYWxyZWFkeSByZWdpc3RlcmVkLmApO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5tb2R1bGVzLnNldChtb2R1bGUuZ2V0TmFtZSgpLCBtb2R1bGUpO1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3QgXSBvZiBtb2R1bGUuZ2V0Q29uc3RydWN0cygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiVXNlTW9kdWxlOiBSZWdpc3RlcmluZyBjb25zdHJ1Y3Q6IFwiLCBjb25zdHJ1Y3ROYW1lLCBtb2R1bGUuZ2V0RGVwZW5kZW5jaWVzKCksIGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgY29uc3RydWN0LmRlcGVuZGVuY2llcyA9IG1vZHVsZS5nZXREZXBlbmRlbmNpZXMoKTtcbiAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0LCBjb25zdHJ1Y3ROYW1lKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHVibGljIGFzeW5jIHJ1bigpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlJ1bm5pbmcgZncyNCBpbmZyYXN0cnVjdHVyZS4uLlwiKTtcblxuICAgICAgICAvLyBDcmVhdGUgZGVmYXVsdCBmdzI0IHJ1bnRpbWUgbGF5ZXIgKE9OTFkgcnVudGltZSBjb2RlLCBub3QgaW5mcmFzdHJ1Y3R1cmUpXG4gICAgICAgIC8vIFRoaXMgbGF5ZXIgaXMgYXV0b21hdGljYWxseSBhdHRhY2hlZCB0byBhbGwgTGFtYmRhIGZ1bmN0aW9uc1xuICAgICAgICAvLyBJdCdzIE5PVCBhbiBlbnRyeSBwYWNrYWdlIC0gaXQncyBqdXN0IGF2YWlsYWJsZSBmb3IgaW1wb3J0c1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQnVpbGRpbmcgZncyNCBydW50aW1lIGxheWVyLi4uXCIpO1xuICAgICAgICBjb25zdCBmdzI0TGF5ZXIgPSBuZXcgTGF5ZXJDb25zdHJ1Y3QoWyB7XG4gICAgICAgICAgICBtb2RlOiAnQlVJTERfQU5EX1BBQ0tBR0UnLFxuICAgICAgICAgICAgLy8gQnVuZGxlIHRoZSBmdzI0IHJ1bnRpbWUgc291cmNlIChoYXMgaW1wb3J0cywgbmVlZHMgYnVuZGxpbmcgd2l0aCBlc2J1aWxkKVxuICAgICAgICAgICAgc291cmNlUGF0aDogJy4vbm9kZV9tb2R1bGVzL0B0ZW4yNGdyb3VwL2Z3MjQvZGlzdC9wYWNrYWdlL2xheWVyL2Z3MjQuanMnLFxuICAgICAgICAgICAgcGFja2FnZVBhdGg6ICdAdGVuMjRncm91cC9mdzI0JyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAwLFxuICAgICAgICAgICAgLy8gT3V0cHV0IHRvIGFwcGxpY2F0aW9uJ3MgZGlzdC9sYXllcnMgZGlyZWN0b3J5LCBub3QgZnJhbWV3b3JrJ3MgZGlyZWN0b3J5XG4gICAgICAgICAgICBkaXN0RGlyZWN0b3J5OiBwYXRoSm9pbihwcm9jZXNzLmN3ZCgpLCAnZGlzdC9sYXllcnMnKSxcbiAgICAgICAgICAgIGJ1aWxkT3B0aW9uczoge1xuICAgICAgICAgICAgICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBleHRlcm5hbDogWyAnQGF3cy1zZGsnLCAnQHNtaXRoeScgXSAvLyBBV1MgU0RLIGlzIE5PVCBwcm92aWRlZCBieSBMYW1iZGEgcnVudGltZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGlzRW50cnlQYWNrYWdlOiBmYWxzZSxcbiAgICAgICAgfSBdKTtcbiAgICAgICAgYXdhaXQgZncyNExheWVyLmNvbnN0cnVjdCgpO1xuXG4gICAgICAgIC8vICoqKiBvcmRlciBpcyBpbXBvcnRhbnQgaGVyZSwgbW9kdWxlcyBuZWVkIHRvIGJlIHByb2Nlc3NlZCBmaXJzdCwgYmVmb3JlIGNvbnN0cnVjdHMgKioqXG4gICAgICAgIHRoaXMucHJvY2Vzc01vZHVsZXMoKTtcblxuICAgICAgICBjb25zdCBkaXNhYmxlVUlDb25maWdHZW4gPSBGdzI0LmdldEluc3RhbmNlKCkuZ2V0Q29uZmlnKCkuZGlzYWJsZVVJQ29uZmlnR2VuO1xuXG4gICAgICAgIGlmICghZGlzYWJsZVVJQ29uZmlnR2VuKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnVpQ29uZmlnR2VuLnJ1bigpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gY29uZmlndXJlIGEgYnVpbGQgY29tbWFuZCBsaWtlIGluIHBhY2thZ2UuanNvbiB0byBvbmx5IGdlbmVyYXRlIHRoZSB1aSBjb25maWdcbiAgICAgICAgLy8gXCJ1aTpnZW5cIjogXCJVSV9HRU5fT05MWT10cnVlIGVudi1jbWQgLWYgLmVudi5sb2NhbCB0cy1ub2RlIHNyYy9pbmRleC50c1wiXG4gICAgICAgIC8vIHRoaXMgaXMgdXNlZnVsIGZvciBnZW5lcmF0aW5nIHRoZSB1aSBjb25maWcgZHVyaW5nIGRldmVsb3BtZW50XG4gICAgICAgIGlmIChwcm9jZXNzLmVudi5VSV9HRU5fT05MWSA9PT0gJ3RydWUnKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdVSSBjb25maWcgZ2VuZXJhdGlvbiBjb21wbGV0ZS4gRXhpdGluZy4nKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRvdGFsQ29uc3RydWN0cyA9IHRoaXMuY29uc3RydWN0cy5zaXplO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfWApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDwn5qAIEJ1aWxkaW5nICR7dG90YWxDb25zdHJ1Y3RzfSBjb25zdHJ1Y3QocykuLi5gKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgJHsnPScucmVwZWF0KDYwKX1cXG5gKTtcblxuICAgICAgICBhd2FpdCB0aGlzLmNvbnN0cnVjdEFsbFJlc291cmNlcygpXG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgJHsnPScucmVwZWF0KDYwKX1gKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg4pyFIEFsbCBjb25zdHJ1Y3RzIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHlgKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgJHsnPScucmVwZWF0KDYwKX1cXG5gKTtcbiAgICB9XG5cblxuICAgIHByaXZhdGUgcmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0OiBGVzI0Q29uc3RydWN0LCBuYW1lPzogc3RyaW5nKSB7XG4gICAgICAgIGxldCBjb25zdHJ1Y3ROYW1lID0gbmFtZSB8fCBjb25zdHJ1Y3QubmFtZTtcbiAgICAgICAgaWYgKHRoaXMuY29uc3RydWN0cy5oYXMoY29uc3RydWN0TmFtZSkpIHtcbiAgICAgICAgICAgIC8vIGhhbmRsZSBtdWx0aXBsZSBjb25zdHJ1Y3RzIG9mIHNhbWUgdHlwZVxuICAgICAgICAgICAgY29uc3QgbmV3Q29uc3RydWN0TmFtZSA9IGNvbnN0cnVjdE5hbWUuY29uY2F0KCctJywgcmFuZG9tVVVJRCgpKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbnN0cnVjdCB3aXRoIG5hbWUgJHtjb25zdHJ1Y3ROYW1lfSBpcyBhbHJlYWR5IHJlZ2lzdGVyZWQsIHJlbmFtaW5nIHRvICR7bmV3Q29uc3RydWN0TmFtZX1gKTtcbiAgICAgICAgICAgIGNvbnN0cnVjdE5hbWUgPSBuZXdDb25zdHJ1Y3ROYW1lO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY29uc3RydWN0cy5zZXQoY29uc3RydWN0TmFtZSwgY29uc3RydWN0KTtcbiAgICAgICAgdGhpcy5mdzI0LmFkZENvbnN0cnVjdChjb25zdHJ1Y3QpO1xuICAgIH1cblxuICAgIHByaXZhdGUgcHJvY2Vzc01vZHVsZXMoKSB7XG4gICAgICAgIGZvciAoY29uc3QgWyBtb2R1bGVOYW1lLCBtb2R1bGUgXSBvZiB0aGlzLm1vZHVsZXMpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5hZGRNb2R1bGUobW9kdWxlTmFtZSwgbW9kdWxlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgY29uc3RydWN0QWxsUmVzb3VyY2VzKCkge1xuICAgICAgICBjb25zdCBhbGxDb25zdHJ1Y3RzID0gQXJyYXkuZnJvbSh0aGlzLmNvbnN0cnVjdHMua2V5cygpKS5tYXAoY29uc3RydWN0TmFtZSA9PiB0aGlzLmNvbnN0cnVjdFJlc291cmNlcyhjb25zdHJ1Y3ROYW1lKSk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChhbGxDb25zdHJ1Y3RzKTtcbiAgICB9XG5cbiAgICBhc3luYyBjb25zdHJ1Y3RSZXNvdXJjZXMoY29uc3RydWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGNvbnN0cnVjdCA9IHRoaXMuY29uc3RydWN0cy5nZXQoY29uc3RydWN0TmFtZSk7XG4gICAgICAgIGlmICghY29uc3RydWN0KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnN0cnVjdCAke2NvbnN0cnVjdE5hbWV9IG5vdCBmb3VuZGApO1xuICAgICAgICB9XG5cbiAgICAgICAgd2hpbGUgKHRoaXMucmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3kgPj0gdGhpcy5yZXNvdXJjZUNvbnN0cnVjdE1heENvbmN1cnJlbmN5KSB7XG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwKSk7IC8vIFRocm90dGxlIGlmIGNvbmN1cnJlbmN5IGxpbWl0IGlzIHJlYWNoZWRcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE9ubHkgbG9nIGlmIHRoZXJlIGFyZSBhY3R1YWwgZGVwZW5kZW5jaWVzXG4gICAgICAgIGlmIChjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzICYmIGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYOKPsyAke2NvbnN0cnVjdE5hbWV9OiBXYWl0aW5nIGZvciBkZXBlbmRlbmNpZXM6ICR7Y29uc3RydWN0LmRlcGVuZGVuY2llcy5qb2luKCcsICcpfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gV2FpdCBmb3IgZGVwZW5kZW5jaWVzIHRvIHJlc29sdmVcbiAgICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yRGVwZW5kZW5jaWVzKGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMsIGNvbnN0cnVjdE5hbWUpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCflKggQnVpbGRpbmcgJHtjb25zdHJ1Y3ROYW1lfS4uLmApO1xuXG4gICAgICAgIHRoaXMucmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3krKztcbiAgICAgICAgY29uc3QgdGltZXIgPSBUaW1lci5zdGFydCgpO1xuICAgICAgICBjb25zdCBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IGNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgJHtjb25zdHJ1Y3ROYW1lfSBjb21wbGV0ZWQgaW4gJHt0aW1lci5lbGFwc2VkU2Vjb25kcygpfWApO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihg4p2MICR7Y29uc3RydWN0TmFtZX0gZmFpbGVkOmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjsgLy8gUmUtdGhyb3cgdG8gZW5zdXJlIGRlcGxveW1lbnQgZmFpbHNcbiAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgdGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeS0tO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KSgpO1xuXG4gICAgICAgIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5zZXQoY29uc3RydWN0TmFtZSwgY29uc3RydWN0Q29tcGxldGlvblByb21pc2UpO1xuICAgICAgICByZXR1cm4gY29uc3RydWN0Q29tcGxldGlvblByb21pc2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yRGVwZW5kZW5jaWVzKGRlcGVuZGVuY2llczogc3RyaW5nW10sIGNvbnN0cnVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAoIWRlcGVuZGVuY2llcyB8fCBkZXBlbmRlbmNpZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwcm9taXNlcyA9IGRlcGVuZGVuY2llcy5tYXAoZGVwZW5kZW5jeSA9PiB7XG4gICAgICAgICAgICAvLyBpZiBkZXBlbmRlbmN5IGNvbnN0cnVjdCBkb2VzIG5vdCBleGlzdHMgaW4gdGhlIGNvbnN0cnVjdCBsaXN0LCBtYXJrIGl0IGFzIHByb2Nlc3NlZFxuICAgICAgICAgICAgaWYgKCF0aGlzLmNvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7Y29uc3RydWN0TmFtZX06IERlcGVuZGVuY3kgJHtkZXBlbmRlbmN5fSBub3QgcmVnaXN0ZXJlZCAob3B0aW9uYWwgZGVwZW5kZW5jeSlgKTtcbiAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuc2V0KGRlcGVuZGVuY3ksIFByb21pc2UucmVzb2x2ZSgpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmhhcyhkZXBlbmRlbmN5KSkge1xuICAgICAgICAgICAgICAgIC8vIElmIGRlcGVuZGVuY3kgbm90IHNjaGVkdWxlZCB5ZXQsIGxpc3RlbiBmb3IgaXRzIGFkZGl0aW9uXG4gICAgICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaW50ZXJ2YWwgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmhhcyhkZXBlbmRlbmN5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwoaW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5nZXQoZGVwZW5kZW5jeSkhLnRoZW4ocmVzb2x2ZSwgcmVqZWN0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSwgMTAwKTsgLy8gQ2hlY2sgZXZlcnkgMTAwbXNcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuZ2V0KGRlcGVuZGVuY3kpITtcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcbiAgICB9XG5cbn1cbiJdfQ==