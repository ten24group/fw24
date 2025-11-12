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
                sourcePath: './dist/layer',
                priority: 0
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsNkNBQXlDO0FBQ3pDLHNDQUFtQztBQUluQywrRUFBeUU7QUFDekUsdUNBQStEO0FBQy9ELDZDQUE4QztBQUM5QyxtQ0FBb0M7QUFFcEMsTUFBYSxXQUFXO0lBQ1gsTUFBTSxDQUFVO0lBQ3pCLFNBQVMsQ0FBUztJQUVGLElBQUksQ0FBTztJQUNYLFdBQVcsQ0FBb0I7SUFDOUIsVUFBVSxDQUE2QjtJQUN2QyxPQUFPLENBQTJCO0lBQzNDLG1CQUFtQixHQUErQixJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQzVELCtCQUErQixHQUFXLEVBQUUsQ0FBQztJQUM3QyxtQ0FBbUMsR0FBRyxDQUFDLENBQUM7SUFFaEQsWUFBWSxTQUE2QixFQUFFO1FBQ3ZDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLENBQUUsV0FBVyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxXQUFXLENBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUU1RixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO1FBRXhELElBQUksQ0FBQyxJQUFJLEdBQUcsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQy9CLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSx3Q0FBaUIsRUFBRSxDQUFDO1FBQzNDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRTVCLElBQUksTUFBTSxDQUFDLG9CQUFvQixFQUFFLENBQUM7WUFDOUIsTUFBTSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFFLEdBQUcsRUFBRSxLQUFL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TyxFQUFFLENBQUMsQ0FBQztZQUNoRSxDQUFDO1lBQ0QsSUFBSSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztnQkFDNUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsYUFBYSxhQUFhLDJDQUEyQyxVQUFVLEtBQUssQ0FBQyxDQUFDO2dCQUN2RywyREFBMkQ7Z0JBQzNELE9BQU8sSUFBSSxPQUFPLENBQU8sQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7b0JBQ3pDLE1BQU0sUUFBUSxHQUFHLFdBQVcsQ0FBQyxHQUFHLEVBQUU7d0JBQzlCLElBQUksSUFBSSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDOzRCQUMzQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUM7NEJBQ3hCLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFFLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQzs0QkFDaEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsYUFBYSxhQUFhLGdCQUFnQixVQUFVLFlBQVksQ0FBQyxDQUFDO3dCQUN2RixDQUFDO29CQUNMLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLG9CQUFvQjtnQkFDakMsQ0FBQyxDQUFDLENBQUM7WUFDUCxDQUFDO1lBQ0QsT0FBTyxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBRSxDQUFDO1FBQ3JELENBQUMsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ2hDLENBQUM7Q0FFSjtBQTNMRCxrQ0EyTEM7QUFuSGdCO0lBRFosSUFBQSxxQkFBVyxHQUFFO3NDQWlDYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFwcCwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IElBcHBsaWNhdGlvbkNvbmZpZyB9IGZyb20gXCIuL2ludGVyZmFjZXMvY29uZmlnXCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0IH0gZnJvbSBcIi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IElGdzI0TW9kdWxlIH0gZnJvbSBcIi4vY29yZS9ydW50aW1lL21vZHVsZVwiO1xuaW1wb3J0IHsgRW50aXR5VUlDb25maWdHZW4gfSBmcm9tIFwiLi91aS1jb25maWctZ2VuL2VudGl0eS11aS1jb25maWcuZ2VuXCI7XG5pbXBvcnQgeyBJTG9nZ2VyLCBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcblxuZXhwb3J0IGNsYXNzIEFwcGxpY2F0aW9uIHtcbiAgICByZWFkb25seSBsb2dnZXI6IElMb2dnZXI7XG4gICAgbWFpblN0YWNrITogU3RhY2s7XG5cbiAgICBwdWJsaWMgcmVhZG9ubHkgZncyNDogRncyNDtcbiAgICBwdWJsaWMgcmVhZG9ubHkgdWlDb25maWdHZW46IEVudGl0eVVJQ29uZmlnR2VuO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY29uc3RydWN0czogTWFwPHN0cmluZywgRlcyNENvbnN0cnVjdD47XG4gICAgcHJpdmF0ZSByZWFkb25seSBtb2R1bGVzOiBNYXA8c3RyaW5nLCBJRncyNE1vZHVsZT47XG4gICAgcHJpdmF0ZSBwcm9jZXNzZWRDb25zdHJ1Y3RzOiBNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+PiA9IG5ldyBNYXAoKTtcbiAgICBwcml2YXRlIHJlc291cmNlQ29uc3RydWN0TWF4Q29uY3VycmVuY3k6IG51bWJlciA9IDEwO1xuICAgIHByaXZhdGUgcmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3kgPSAwO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnOiBJQXBwbGljYXRpb25Db25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihbIEFwcGxpY2F0aW9uLm5hbWUsIGNvbmZpZy5uYW1lLCBjb25maWcuZW52aXJvbm1lbnQgXS5qb2luKCctJykpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJJbml0aWFsaXppbmcgZncyNCBpbmZyYXN0cnVjdHVyZS4uLlwiKTtcblxuICAgICAgICB0aGlzLmZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgICAgIHRoaXMudWlDb25maWdHZW4gPSBuZXcgRW50aXR5VUlDb25maWdHZW4oKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbmZpZyhjb25maWcpO1xuXG4gICAgICAgIGlmIChjb25maWcuZW52aXJvbm1lbnRWYXJpYWJsZXMpIHtcbiAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKGNvbmZpZy5lbnZpcm9ubWVudFZhcmlhYmxlcykuZm9yRWFjaCgoWyBrZXksIHZhbHVlIF0pID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKSB7XG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhjb25maWcuZ2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gZW5zdXJlIHRoZXJlJ3MgYSBsb2ctbGV2ZWwgc2V0IGluIHRoZSBmdzI0IHNjb3BlIHNvIHRoYXQgdGhlIGNvbnN0cnVjdHMgY2FuIGFzayBmb3IgdGhpcyB2YWx1ZVxuICAgICAgICAvLyB0aGlzJ3Mgb25seSB0aGUgZ2xvYmFsIHZhbHVlLCBhbmQgY2FuIGJlIG92ZXJyaWRkZW4gYnkgZWFjaCBsYW1iZGEgZnVuY3Rpb24uXG4gICAgICAgIGlmICghdGhpcy5mdzI0Lmhhc0Vudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcpKSB7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnTE9HX0xFVkVMJywgcHJvY2Vzcy5lbnYuTE9HX0xFVkVMIHx8ICdJTkZPJyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmNvbnN0cnVjdHMgPSBuZXcgTWFwKCk7XG4gICAgICAgIHRoaXMubW9kdWxlcyA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBpbml0aWFsaXplIHRoZSBtYWluIHN0YWNrXG4gICAgICAgIGNvbnN0IGFwcCA9IG5ldyBBcHAoKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldEFwcChhcHApO1xuXG4gICAgfVxuXG4gICAgcHVibGljIHVzZShjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QpOiBBcHBsaWNhdGlvbiB7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0KTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgcHVibGljIHVzZU1vZHVsZShtb2R1bGU6IElGdzI0TW9kdWxlKTogQXBwbGljYXRpb24ge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNhbGxlZCBVc2VNb2R1bGUgd2l0aCBtb2R1bGU6IFwiLCB7IG1vZHVsZU5hbWU6IG1vZHVsZS5nZXROYW1lKCkgfSk7XG5cbiAgICAgICAgaWYgKHRoaXMubW9kdWxlcy5oYXMobW9kdWxlLmdldE5hbWUoKSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kdWxlIHdpdGggbmFtZSAke21vZHVsZS5nZXROYW1lKCl9IGlzIGFscmVhZHkgcmVnaXN0ZXJlZC5gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubW9kdWxlcy5zZXQobW9kdWxlLmdldE5hbWUoKSwgbW9kdWxlKTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsgY29uc3RydWN0TmFtZSwgY29uc3RydWN0IF0gb2YgbW9kdWxlLmdldENvbnN0cnVjdHMoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlVzZU1vZHVsZTogUmVnaXN0ZXJpbmcgY29uc3RydWN0OiBcIiwgY29uc3RydWN0TmFtZSwgbW9kdWxlLmdldERlcGVuZGVuY2llcygpLCBjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgIGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMgPSBtb2R1bGUuZ2V0RGVwZW5kZW5jaWVzKCk7XG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ29uc3RydWN0KGNvbnN0cnVjdCwgY29uc3RydWN0TmFtZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBydW4oKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJSdW5uaW5nIGZ3MjQgaW5mcmFzdHJ1Y3R1cmUuLi5cIik7XG5cbiAgICAgICAgLy8gYnVpbGQgZncyNCBsYXllclxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQnVpbGRpbmcgZncyNCBsYXllci4uLlwiKTtcbiAgICAgICAgY29uc3QgZncyNExheWVyID0gbmV3IExheWVyQ29uc3RydWN0KFsge1xuICAgICAgICAgICAgbGF5ZXJOYW1lOiAnZncyNCcsXG4gICAgICAgICAgICBzb3VyY2VQYXRoOiAnLi9kaXN0L2xheWVyJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAwXG4gICAgICAgIH0gXSk7XG4gICAgICAgIGZ3MjRMYXllci5jb25zdHJ1Y3QoKTtcblxuICAgICAgICAvLyAqKiogb3JkZXIgaXMgaW1wb3J0YW50IGhlcmUsIG1vZHVsZXMgbmVlZCB0byBiZSBwcm9jZXNzZWQgZmlyc3QsIGJlZm9yZSBjb25zdHJ1Y3RzICoqKlxuICAgICAgICB0aGlzLnByb2Nlc3NNb2R1bGVzKCk7XG5cbiAgICAgICAgY29uc3QgZGlzYWJsZVVJQ29uZmlnR2VuID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldENvbmZpZygpLmRpc2FibGVVSUNvbmZpZ0dlbjtcblxuICAgICAgICBpZiAoIWRpc2FibGVVSUNvbmZpZ0dlbikge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy51aUNvbmZpZ0dlbi5ydW4oKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNvbmZpZ3VyZSBhIGJ1aWxkIGNvbW1hbmQgbGlrZSBpbiBwYWNrYWdlLmpzb24gdG8gb25seSBnZW5lcmF0ZSB0aGUgdWkgY29uZmlnXG4gICAgICAgIC8vIFwidWk6Z2VuXCI6IFwiVUlfR0VOX09OTFk9dHJ1ZSBlbnYtY21kIC1mIC5lbnYubG9jYWwgdHMtbm9kZSBzcmMvaW5kZXgudHNcIlxuICAgICAgICAvLyB0aGlzIGlzIHVzZWZ1bCBmb3IgZ2VuZXJhdGluZyB0aGUgdWkgY29uZmlnIGR1cmluZyBkZXZlbG9wbWVudFxuICAgICAgICBpZiAocHJvY2Vzcy5lbnYuVUlfR0VOX09OTFkgPT09ICd0cnVlJykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnVUkgY29uZmlnIGdlbmVyYXRpb24gY29tcGxldGUuIEV4aXRpbmcuJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLmNvbnN0cnVjdEFsbFJlc291cmNlcygpXG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnQWxsIGNvbnN0cnVjdCByZXNvdXJjZSBjcmVhdGlvbiBjb21wbGV0ZWQnKTtcbiAgICB9XG5cblxuICAgIHByaXZhdGUgcmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0OiBGVzI0Q29uc3RydWN0LCBuYW1lPzogc3RyaW5nKSB7XG4gICAgICAgIGxldCBjb25zdHJ1Y3ROYW1lID0gbmFtZSB8fCBjb25zdHJ1Y3QubmFtZTtcbiAgICAgICAgaWYgKHRoaXMuY29uc3RydWN0cy5oYXMoY29uc3RydWN0TmFtZSkpIHtcbiAgICAgICAgICAgIC8vIGhhbmRsZSBtdWx0aXBsZSBjb25zdHJ1Y3RzIG9mIHNhbWUgdHlwZVxuICAgICAgICAgICAgY29uc3QgbmV3Q29uc3RydWN0TmFtZSA9IGNvbnN0cnVjdE5hbWUuY29uY2F0KCctJywgcmFuZG9tVVVJRCgpKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbnN0cnVjdCB3aXRoIG5hbWUgJHtjb25zdHJ1Y3ROYW1lfSBpcyBhbHJlYWR5IHJlZ2lzdGVyZWQsIHJlbmFtaW5nIHRvICR7bmV3Q29uc3RydWN0TmFtZX1gKTtcbiAgICAgICAgICAgIGNvbnN0cnVjdE5hbWUgPSBuZXdDb25zdHJ1Y3ROYW1lO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY29uc3RydWN0cy5zZXQoY29uc3RydWN0TmFtZSwgY29uc3RydWN0KTtcbiAgICAgICAgdGhpcy5mdzI0LmFkZENvbnN0cnVjdChjb25zdHJ1Y3QpO1xuICAgIH1cblxuICAgIHByaXZhdGUgcHJvY2Vzc01vZHVsZXMoKSB7XG4gICAgICAgIGZvciAoY29uc3QgWyBtb2R1bGVOYW1lLCBtb2R1bGUgXSBvZiB0aGlzLm1vZHVsZXMpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5hZGRNb2R1bGUobW9kdWxlTmFtZSwgbW9kdWxlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgY29uc3RydWN0QWxsUmVzb3VyY2VzKCkge1xuICAgICAgICBjb25zdCBhbGxDb25zdHJ1Y3RzID0gQXJyYXkuZnJvbSh0aGlzLmNvbnN0cnVjdHMua2V5cygpKS5tYXAoY29uc3RydWN0TmFtZSA9PiB0aGlzLmNvbnN0cnVjdFJlc291cmNlcyhjb25zdHJ1Y3ROYW1lKSk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChhbGxDb25zdHJ1Y3RzKTtcbiAgICB9XG5cbiAgICBhc3luYyBjb25zdHJ1Y3RSZXNvdXJjZXMoY29uc3RydWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGNvbnN0cnVjdCA9IHRoaXMuY29uc3RydWN0cy5nZXQoY29uc3RydWN0TmFtZSk7XG4gICAgICAgIGlmICghY29uc3RydWN0KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnN0cnVjdCAke2NvbnN0cnVjdE5hbWV9IG5vdCBmb3VuZGApO1xuICAgICAgICB9XG5cbiAgICAgICAgd2hpbGUgKHRoaXMucmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3kgPj0gdGhpcy5yZXNvdXJjZUNvbnN0cnVjdE1heENvbmN1cnJlbmN5KSB7XG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwKSk7IC8vIFRocm90dGxlIGlmIGNvbmN1cnJlbmN5IGxpbWl0IGlzIHJlYWNoZWRcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFByb2Nlc3NpbmcgY29uc3RydWN0ICR7Y29uc3RydWN0TmFtZX0uLi5gKTtcblxuICAgICAgICAvLyBXYWl0IGZvciBkZXBlbmRlbmNpZXMgdG8gcmVzb2x2ZVxuICAgICAgICBhd2FpdCB0aGlzLndhaXRGb3JEZXBlbmRlbmNpZXMoY29uc3RydWN0LmRlcGVuZGVuY2llcywgY29uc3RydWN0TmFtZSk7XG5cbiAgICAgICAgdGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSsrO1xuICAgICAgICBjb25zdCBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IGNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTdWNjZXNzZnVsbHkgY29tcGxldGVkIGNvbnN0cnVjdCAke2NvbnN0cnVjdE5hbWV9YCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gY29uc3RydWN0ICR7Y29uc3RydWN0TmFtZX06YCwgZXJyb3IpO1xuICAgICAgICAgICAgICAgIHRocm93IGVycm9yOyAvLyBSZS10aHJvdyB0byBlbnN1cmUgZGVwbG95bWVudCBmYWlsc1xuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5LS07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKCk7XG5cbiAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZSk7XG4gICAgICAgIHJldHVybiBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHdhaXRGb3JEZXBlbmRlbmNpZXMoZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSwgY29uc3RydWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gZGVwZW5kZW5jaWVzLm1hcChkZXBlbmRlbmN5ID0+IHtcbiAgICAgICAgICAgIC8vIGlmIGRlcGVuZGVuY3kgY29uc3RydWN0IGRvZXMgbm90IGV4aXN0cyBpbiB0aGUgY29uc3RydWN0IGxpc3QsIG1hcmsgaXQgYXMgcHJvY2Vzc2VkXG4gICAgICAgICAgICBpZiAoIXRoaXMuY29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBEZXBlbmRlbmN5IGNvbnN0cnVjdCAke2RlcGVuZGVuY3l9IG5vdCBmb3VuZCwgbWFya2luZyBpdCByZXNvbHZlZC5gKTtcbiAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuc2V0KGRlcGVuZGVuY3ksIFByb21pc2UucmVzb2x2ZSgpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmhhcyhkZXBlbmRlbmN5KSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbnN0cnVjdCAke2NvbnN0cnVjdE5hbWV9OiBXYWl0aW5nIGZvciBkZXBlbmRlbmN5IHRvIGJlIHJlc29sdmVkICR7ZGVwZW5kZW5jeX0uLi5gKTtcbiAgICAgICAgICAgICAgICAvLyBJZiBkZXBlbmRlbmN5IG5vdCBzY2hlZHVsZWQgeWV0LCBsaXN0ZW4gZm9yIGl0cyBhZGRpdGlvblxuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGVhckludGVydmFsKGludGVydmFsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuZ2V0KGRlcGVuZGVuY3kpIS50aGVuKHJlc29sdmUsIHJlamVjdCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29uc3RydWN0ICR7Y29uc3RydWN0TmFtZX06IERlcGVuZGVuY3kgJHtkZXBlbmRlbmN5fSByZXNvbHZlZC5gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSwgMTAwKTsgLy8gQ2hlY2sgZXZlcnkgMTAwbXNcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuZ2V0KGRlcGVuZGVuY3kpITtcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcbiAgICB9XG5cbn1cbiJdfQ==