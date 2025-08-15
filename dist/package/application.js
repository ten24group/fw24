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
const crypto_1 = require("crypto");
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
        // build fw24 layer
        this.logger.info("Building fw24 layer...");
        const fw24Layer = new constructs_1.LayerConstruct([{
                layerName: 'fw24',
                sourcePath: './dist/layer'
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
        await this.constructAllResources();
        this.logger.info('All construct resource creation completed');
    }
    registerConstruct(construct, name) {
        let constructName = name || construct.name;
        if (this.constructs.has(constructName)) {
            // handle multiple constructs of same type
            const newConstructName = constructName.concat('-', (0, crypto_1.randomUUID)());
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
        this.logger.info(`Processing construct ${constructName}...`);
        // Wait for dependencies to resolve
        await this.waitForDependencies(construct.dependencies, constructName);
        this.resourceConstructCurrentConcurrency++;
        const constructCompletionPromise = (async () => {
            try {
                await construct.construct();
                this.logger.info(`Successfully completed construct ${constructName}`);
            }
            catch (error) {
                this.logger.error(`Failed to construct ${constructName}:`, error);
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
        const promises = dependencies.map(dependency => {
            // if dependency construct does not exists in the construct list, mark it as processed
            if (!this.constructs.has(dependency)) {
                this.logger.info(`Dependency construct ${dependency} not found, marking it resolved.`);
                this.processedConstructs.set(dependency, Promise.resolve());
            }
            if (!this.processedConstructs.has(dependency)) {
                this.logger.info(`Construct ${constructName}: Waiting for dependency to be resolved ${dependency}...`);
                // If dependency not scheduled yet, listen for its addition
                return new Promise((resolve, reject) => {
                    const interval = setInterval(() => {
                        if (this.processedConstructs.has(dependency)) {
                            clearInterval(interval);
                            this.processedConstructs.get(dependency).then(resolve, reject);
                            this.logger.info(`Construct ${constructName}: Dependency ${dependency} resolved.`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsNkNBQXlDO0FBQ3pDLHNDQUFtQztBQUluQywrRUFBeUU7QUFDekUsdUNBQStEO0FBQy9ELDZDQUE4QztBQUM5QyxtQ0FBb0M7QUFFcEMsTUFBYSxXQUFXO0lBQ1gsTUFBTSxDQUFVO0lBQ3pCLFNBQVMsQ0FBUztJQUVGLElBQUksQ0FBTztJQUNYLFdBQVcsQ0FBb0I7SUFDOUIsVUFBVSxDQUE2QjtJQUN2QyxPQUFPLENBQTJCO0lBQzNDLG1CQUFtQixHQUErQixJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQzVELCtCQUErQixHQUFXLEVBQUUsQ0FBQztJQUM3QyxtQ0FBbUMsR0FBRyxDQUFDLENBQUM7SUFFaEQsWUFBWSxTQUE2QixFQUFFO1FBQ3ZDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLENBQUUsV0FBVyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxXQUFXLENBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUU1RixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO1FBRXhELElBQUksQ0FBQyxJQUFJLEdBQUcsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQy9CLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSx3Q0FBaUIsRUFBRSxDQUFDO1FBQzNDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRTVCLElBQUksTUFBTSxDQUFDLG9CQUFvQixFQUFFLENBQUM7WUFDOUIsTUFBTSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFFLEdBQUcsRUFBRSxLQUFL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RSxDQUFDO1lBQ0QsSUFBSSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztnQkFDNUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsYUFBYSxhQUFhLDJDQUEyQyxVQUFVLEtBQUssQ0FBQyxDQUFDO2dCQUN2RywyREFBMkQ7Z0JBQzNELE9BQU8sSUFBSSxPQUFPLENBQU8sQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7b0JBQ3pDLE1BQU0sUUFBUSxHQUFHLFdBQVcsQ0FBQyxHQUFHLEVBQUU7d0JBQzlCLElBQUksSUFBSSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDOzRCQUMzQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUM7NEJBQ3hCLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFFLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQzs0QkFDaEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsYUFBYSxhQUFhLGdCQUFnQixVQUFVLFlBQVksQ0FBQyxDQUFDO3dCQUN2RixDQUFDO29CQUNMLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLG9CQUFvQjtnQkFDakMsQ0FBQyxDQUFDLENBQUM7WUFDUCxDQUFDO1lBQ0QsT0FBTyxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBRSxDQUFDO1FBQ3JELENBQUMsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ2hDLENBQUM7Q0FFSjtBQTFMRCxrQ0EwTEM7QUFsSGdCO0lBRFosSUFBQSxxQkFBVyxHQUFFO3NDQWdDYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFwcCwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IElBcHBsaWNhdGlvbkNvbmZpZyB9IGZyb20gXCIuL2ludGVyZmFjZXMvY29uZmlnXCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0IH0gZnJvbSBcIi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IElGdzI0TW9kdWxlIH0gZnJvbSBcIi4vY29yZS9ydW50aW1lL21vZHVsZVwiO1xuaW1wb3J0IHsgRW50aXR5VUlDb25maWdHZW4gfSBmcm9tIFwiLi91aS1jb25maWctZ2VuL2VudGl0eS11aS1jb25maWcuZ2VuXCI7XG5pbXBvcnQgeyBJTG9nZ2VyLCBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcblxuZXhwb3J0IGNsYXNzIEFwcGxpY2F0aW9uIHtcbiAgICByZWFkb25seSBsb2dnZXI6IElMb2dnZXI7XG4gICAgbWFpblN0YWNrITogU3RhY2s7XG5cbiAgICBwdWJsaWMgcmVhZG9ubHkgZncyNDogRncyNDtcbiAgICBwdWJsaWMgcmVhZG9ubHkgdWlDb25maWdHZW46IEVudGl0eVVJQ29uZmlnR2VuO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY29uc3RydWN0czogTWFwPHN0cmluZywgRlcyNENvbnN0cnVjdD47XG4gICAgcHJpdmF0ZSByZWFkb25seSBtb2R1bGVzOiBNYXA8c3RyaW5nLCBJRncyNE1vZHVsZT47XG4gICAgcHJpdmF0ZSBwcm9jZXNzZWRDb25zdHJ1Y3RzOiBNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+PiA9IG5ldyBNYXAoKTtcbiAgICBwcml2YXRlIHJlc291cmNlQ29uc3RydWN0TWF4Q29uY3VycmVuY3k6IG51bWJlciA9IDEwO1xuICAgIHByaXZhdGUgcmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3kgPSAwO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnOiBJQXBwbGljYXRpb25Db25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihbIEFwcGxpY2F0aW9uLm5hbWUsIGNvbmZpZy5uYW1lLCBjb25maWcuZW52aXJvbm1lbnQgXS5qb2luKCctJykpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJJbml0aWFsaXppbmcgZncyNCBpbmZyYXN0cnVjdHVyZS4uLlwiKTtcblxuICAgICAgICB0aGlzLmZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgICAgIHRoaXMudWlDb25maWdHZW4gPSBuZXcgRW50aXR5VUlDb25maWdHZW4oKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbmZpZyhjb25maWcpO1xuXG4gICAgICAgIGlmIChjb25maWcuZW52aXJvbm1lbnRWYXJpYWJsZXMpIHtcbiAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKGNvbmZpZy5lbnZpcm9ubWVudFZhcmlhYmxlcykuZm9yRWFjaCgoWyBrZXksIHZhbHVlIF0pID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKSB7XG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhjb25maWcuZ2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gZW5zdXJlIHRoZXJlJ3MgYSBsb2ctbGV2ZWwgc2V0IGluIHRoZSBmdzI0IHNjb3BlIHNvIHRoYXQgdGhlIGNvbnN0cnVjdHMgY2FuIGFzayBmb3IgdGhpcyB2YWx1ZVxuICAgICAgICAvLyB0aGlzJ3Mgb25seSB0aGUgZ2xvYmFsIHZhbHVlLCBhbmQgY2FuIGJlIG92ZXJyaWRkZW4gYnkgZWFjaCBsYW1iZGEgZnVuY3Rpb24uXG4gICAgICAgIGlmICghdGhpcy5mdzI0Lmhhc0Vudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcpKSB7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnTE9HX0xFVkVMJywgcHJvY2Vzcy5lbnYuTE9HX0xFVkVMIHx8ICdJTkZPJyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmNvbnN0cnVjdHMgPSBuZXcgTWFwKCk7XG4gICAgICAgIHRoaXMubW9kdWxlcyA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBpbml0aWFsaXplIHRoZSBtYWluIHN0YWNrXG4gICAgICAgIGNvbnN0IGFwcCA9IG5ldyBBcHAoKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldEFwcChhcHApO1xuXG4gICAgfVxuXG4gICAgcHVibGljIHVzZShjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QpOiBBcHBsaWNhdGlvbiB7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0KTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgcHVibGljIHVzZU1vZHVsZShtb2R1bGU6IElGdzI0TW9kdWxlKTogQXBwbGljYXRpb24ge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNhbGxlZCBVc2VNb2R1bGUgd2l0aCBtb2R1bGU6IFwiLCB7IG1vZHVsZU5hbWU6IG1vZHVsZS5nZXROYW1lKCkgfSk7XG5cbiAgICAgICAgaWYgKHRoaXMubW9kdWxlcy5oYXMobW9kdWxlLmdldE5hbWUoKSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kdWxlIHdpdGggbmFtZSAke21vZHVsZS5nZXROYW1lKCl9IGlzIGFscmVhZHkgcmVnaXN0ZXJlZC5gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubW9kdWxlcy5zZXQobW9kdWxlLmdldE5hbWUoKSwgbW9kdWxlKTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsgY29uc3RydWN0TmFtZSwgY29uc3RydWN0IF0gb2YgbW9kdWxlLmdldENvbnN0cnVjdHMoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlVzZU1vZHVsZTogUmVnaXN0ZXJpbmcgY29uc3RydWN0OiBcIiwgY29uc3RydWN0TmFtZSwgbW9kdWxlLmdldERlcGVuZGVuY2llcygpLCBjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgIGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMgPSBtb2R1bGUuZ2V0RGVwZW5kZW5jaWVzKCk7XG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ29uc3RydWN0KGNvbnN0cnVjdCwgY29uc3RydWN0TmFtZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBydW4oKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJSdW5uaW5nIGZ3MjQgaW5mcmFzdHJ1Y3R1cmUuLi5cIik7XG5cbiAgICAgICAgLy8gYnVpbGQgZncyNCBsYXllclxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQnVpbGRpbmcgZncyNCBsYXllci4uLlwiKTtcbiAgICAgICAgY29uc3QgZncyNExheWVyID0gbmV3IExheWVyQ29uc3RydWN0KFsge1xuICAgICAgICAgICAgbGF5ZXJOYW1lOiAnZncyNCcsXG4gICAgICAgICAgICBzb3VyY2VQYXRoOiAnLi9kaXN0L2xheWVyJ1xuICAgICAgICB9IF0pO1xuICAgICAgICBmdzI0TGF5ZXIuY29uc3RydWN0KCk7XG5cbiAgICAgICAgLy8gKioqIG9yZGVyIGlzIGltcG9ydGFudCBoZXJlLCBtb2R1bGVzIG5lZWQgdG8gYmUgcHJvY2Vzc2VkIGZpcnN0LCBiZWZvcmUgY29uc3RydWN0cyAqKipcbiAgICAgICAgdGhpcy5wcm9jZXNzTW9kdWxlcygpO1xuXG4gICAgICAgIGNvbnN0IGRpc2FibGVVSUNvbmZpZ0dlbiA9IEZ3MjQuZ2V0SW5zdGFuY2UoKS5nZXRDb25maWcoKS5kaXNhYmxlVUlDb25maWdHZW47XG5cbiAgICAgICAgaWYgKCFkaXNhYmxlVUlDb25maWdHZW4pIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMudWlDb25maWdHZW4ucnVuKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjb25maWd1cmUgYSBidWlsZCBjb21tYW5kIGxpa2UgaW4gcGFja2FnZS5qc29uIHRvIG9ubHkgZ2VuZXJhdGUgdGhlIHVpIGNvbmZpZ1xuICAgICAgICAvLyBcInVpOmdlblwiOiBcIlVJX0dFTl9PTkxZPXRydWUgZW52LWNtZCAtZiAuZW52LmxvY2FsIHRzLW5vZGUgc3JjL2luZGV4LnRzXCJcbiAgICAgICAgLy8gdGhpcyBpcyB1c2VmdWwgZm9yIGdlbmVyYXRpbmcgdGhlIHVpIGNvbmZpZyBkdXJpbmcgZGV2ZWxvcG1lbnRcbiAgICAgICAgaWYgKHByb2Nlc3MuZW52LlVJX0dFTl9PTkxZID09PSAndHJ1ZScpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1VJIGNvbmZpZyBnZW5lcmF0aW9uIGNvbXBsZXRlLiBFeGl0aW5nLicpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5jb25zdHJ1Y3RBbGxSZXNvdXJjZXMoKVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ0FsbCBjb25zdHJ1Y3QgcmVzb3VyY2UgY3JlYXRpb24gY29tcGxldGVkJyk7XG4gICAgfVxuXG5cbiAgICBwcml2YXRlIHJlZ2lzdGVyQ29uc3RydWN0KGNvbnN0cnVjdDogRlcyNENvbnN0cnVjdCwgbmFtZT86IHN0cmluZykge1xuICAgICAgICBsZXQgY29uc3RydWN0TmFtZSA9IG5hbWUgfHwgY29uc3RydWN0Lm5hbWU7XG4gICAgICAgIGlmICh0aGlzLmNvbnN0cnVjdHMuaGFzKGNvbnN0cnVjdE5hbWUpKSB7XG4gICAgICAgICAgICAvLyBoYW5kbGUgbXVsdGlwbGUgY29uc3RydWN0cyBvZiBzYW1lIHR5cGVcbiAgICAgICAgICAgIGNvbnN0IG5ld0NvbnN0cnVjdE5hbWUgPSBjb25zdHJ1Y3ROYW1lLmNvbmNhdCgnLScsIHJhbmRvbVVVSUQoKSk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDb25zdHJ1Y3Qgd2l0aCBuYW1lICR7Y29uc3RydWN0TmFtZX0gaXMgYWxyZWFkeSByZWdpc3RlcmVkLCByZW5hbWluZyB0byAke25ld0NvbnN0cnVjdE5hbWV9YCk7XG4gICAgICAgICAgICBjb25zdHJ1Y3ROYW1lID0gbmV3Q29uc3RydWN0TmFtZTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmNvbnN0cnVjdHMuc2V0KGNvbnN0cnVjdE5hbWUsIGNvbnN0cnVjdCk7XG4gICAgICAgIHRoaXMuZncyNC5hZGRDb25zdHJ1Y3QoY29uc3RydWN0KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHByb2Nlc3NNb2R1bGVzKCkge1xuICAgICAgICBmb3IgKGNvbnN0IFsgbW9kdWxlTmFtZSwgbW9kdWxlIF0gb2YgdGhpcy5tb2R1bGVzKSB7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuYWRkTW9kdWxlKG1vZHVsZU5hbWUsIG1vZHVsZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGNvbnN0cnVjdEFsbFJlc291cmNlcygpIHtcbiAgICAgICAgY29uc3QgYWxsQ29uc3RydWN0cyA9IEFycmF5LmZyb20odGhpcy5jb25zdHJ1Y3RzLmtleXMoKSkubWFwKGNvbnN0cnVjdE5hbWUgPT4gdGhpcy5jb25zdHJ1Y3RSZXNvdXJjZXMoY29uc3RydWN0TmFtZSkpO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoYWxsQ29uc3RydWN0cyk7XG4gICAgfVxuXG4gICAgYXN5bmMgY29uc3RydWN0UmVzb3VyY2VzKGNvbnN0cnVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCBjb25zdHJ1Y3QgPSB0aGlzLmNvbnN0cnVjdHMuZ2V0KGNvbnN0cnVjdE5hbWUpO1xuICAgICAgICBpZiAoIWNvbnN0cnVjdCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb25zdHJ1Y3QgJHtjb25zdHJ1Y3ROYW1lfSBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHdoaWxlICh0aGlzLnJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5ID49IHRoaXMucmVzb3VyY2VDb25zdHJ1Y3RNYXhDb25jdXJyZW5jeSkge1xuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDEwMCkpOyAvLyBUaHJvdHRsZSBpZiBjb25jdXJyZW5jeSBsaW1pdCBpcyByZWFjaGVkXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBQcm9jZXNzaW5nIGNvbnN0cnVjdCAke2NvbnN0cnVjdE5hbWV9Li4uYCk7XG5cbiAgICAgICAgLy8gV2FpdCBmb3IgZGVwZW5kZW5jaWVzIHRvIHJlc29sdmVcbiAgICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yRGVwZW5kZW5jaWVzKGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMsIGNvbnN0cnVjdE5hbWUpO1xuXG4gICAgICAgIHRoaXMucmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3krKztcbiAgICAgICAgY29uc3QgY29uc3RydWN0Q29tcGxldGlvblByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCBjb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgU3VjY2Vzc2Z1bGx5IGNvbXBsZXRlZCBjb25zdHJ1Y3QgJHtjb25zdHJ1Y3ROYW1lfWApO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNvbnN0cnVjdCAke2NvbnN0cnVjdE5hbWV9OmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjsgLy8gUmUtdGhyb3cgdG8gZW5zdXJlIGRlcGxveW1lbnQgZmFpbHNcbiAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgdGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeS0tO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KSgpO1xuXG4gICAgICAgIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5zZXQoY29uc3RydWN0TmFtZSwgY29uc3RydWN0Q29tcGxldGlvblByb21pc2UpO1xuICAgICAgICByZXR1cm4gY29uc3RydWN0Q29tcGxldGlvblByb21pc2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yRGVwZW5kZW5jaWVzKGRlcGVuZGVuY2llczogc3RyaW5nW10sIGNvbnN0cnVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCBwcm9taXNlcyA9IGRlcGVuZGVuY2llcy5tYXAoZGVwZW5kZW5jeSA9PiB7XG4gICAgICAgICAgICAvLyBpZiBkZXBlbmRlbmN5IGNvbnN0cnVjdCBkb2VzIG5vdCBleGlzdHMgaW4gdGhlIGNvbnN0cnVjdCBsaXN0LCBtYXJrIGl0IGFzIHByb2Nlc3NlZFxuICAgICAgICAgICAgaWYgKCF0aGlzLmNvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgRGVwZW5kZW5jeSBjb25zdHJ1Y3QgJHtkZXBlbmRlbmN5fSBub3QgZm91bmQsIG1hcmtpbmcgaXQgcmVzb2x2ZWQuYCk7XG4gICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLnNldChkZXBlbmRlbmN5LCBQcm9taXNlLnJlc29sdmUoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIXRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDb25zdHJ1Y3QgJHtjb25zdHJ1Y3ROYW1lfTogV2FpdGluZyBmb3IgZGVwZW5kZW5jeSB0byBiZSByZXNvbHZlZCAke2RlcGVuZGVuY3l9Li4uYCk7XG4gICAgICAgICAgICAgICAgLy8gSWYgZGVwZW5kZW5jeSBub3Qgc2NoZWR1bGVkIHlldCwgbGlzdGVuIGZvciBpdHMgYWRkaXRpb25cbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJJbnRlcnZhbChpbnRlcnZhbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmdldChkZXBlbmRlbmN5KSEudGhlbihyZXNvbHZlLCByZWplY3QpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbnN0cnVjdCAke2NvbnN0cnVjdE5hbWV9OiBEZXBlbmRlbmN5ICR7ZGVwZW5kZW5jeX0gcmVzb2x2ZWQuYCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sIDEwMCk7IC8vIENoZWNrIGV2ZXJ5IDEwMG1zXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmdldChkZXBlbmRlbmN5KSE7XG4gICAgICAgIH0pO1xuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChwcm9taXNlcyk7XG4gICAgfVxuXG59XG4iXX0=