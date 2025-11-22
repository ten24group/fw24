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
const path_1 = require("path");
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
                distDirectory: (0, path_1.join)(process.cwd(), 'dist/layers'),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsNkNBQXlDO0FBQ3pDLHNDQUFtQztBQUluQywrRUFBeUU7QUFDekUsdUNBQStEO0FBQy9ELDZDQUE4QztBQUM5QyxtQ0FBb0M7QUFDcEMsK0JBQXdDO0FBRXhDLE1BQWEsV0FBVztJQUNYLE1BQU0sQ0FBVTtJQUN6QixTQUFTLENBQVM7SUFFRixJQUFJLENBQU87SUFDWCxXQUFXLENBQW9CO0lBQzlCLFVBQVUsQ0FBNkI7SUFDdkMsT0FBTyxDQUEyQjtJQUMzQyxtQkFBbUIsR0FBK0IsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUM1RCwrQkFBK0IsR0FBVyxFQUFFLENBQUM7SUFDN0MsbUNBQW1DLEdBQUcsQ0FBQyxDQUFDO0lBRWhELFlBQVksU0FBNkIsRUFBRTtRQUN2QyxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxDQUFFLFdBQVcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsV0FBVyxDQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFFNUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUNBQXFDLENBQUMsQ0FBQztRQUV4RCxJQUFJLENBQUMsSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUMvQixJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksd0NBQWlCLEVBQUUsQ0FBQztRQUMzQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUU1QixJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQzlCLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLG9CQUFvQixDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBRSxH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SSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUUsQ0FBQztRQUNyRCxDQUFDLENBQUMsQ0FBQztRQUNILE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUNoQyxDQUFDO0NBRUo7QUFyTUQsa0NBcU1DO0FBN0hnQjtJQURaLElBQUEscUJBQVcsR0FBRTtzQ0EyQ2IiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBcHAsIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBJQXBwbGljYXRpb25Db25maWcgfSBmcm9tIFwiLi9pbnRlcmZhY2VzL2NvbmZpZ1wiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCB9IGZyb20gXCIuL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBJRncyNE1vZHVsZSB9IGZyb20gXCIuL2NvcmUvcnVudGltZS9tb2R1bGVcIjtcbmltcG9ydCB7IEVudGl0eVVJQ29uZmlnR2VuIH0gZnJvbSBcIi4vdWktY29uZmlnLWdlbi9lbnRpdHktdWktY29uZmlnLmdlblwiO1xuaW1wb3J0IHsgSUxvZ2dlciwgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuL2xvZ2dpbmdcIjtcbmltcG9ydCB7IExheWVyQ29uc3RydWN0IH0gZnJvbSBcIi4vY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBqb2luIGFzIHBhdGhKb2luIH0gZnJvbSAncGF0aCc7XG5cbmV4cG9ydCBjbGFzcyBBcHBsaWNhdGlvbiB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyOiBJTG9nZ2VyO1xuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgcHVibGljIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQ7XG4gICAgcHVibGljIHJlYWRvbmx5IHVpQ29uZmlnR2VuOiBFbnRpdHlVSUNvbmZpZ0dlbjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbnN0cnVjdHM6IE1hcDxzdHJpbmcsIEZXMjRDb25zdHJ1Y3Q+O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgbW9kdWxlczogTWFwPHN0cmluZywgSUZ3MjRNb2R1bGU+O1xuICAgIHByaXZhdGUgcHJvY2Vzc2VkQ29uc3RydWN0czogTWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj4gPSBuZXcgTWFwKCk7XG4gICAgcHJpdmF0ZSByZXNvdXJjZUNvbnN0cnVjdE1heENvbmN1cnJlbmN5OiBudW1iZXIgPSAxMDtcbiAgICBwcml2YXRlIHJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5ID0gMDtcblxuICAgIGNvbnN0cnVjdG9yKGNvbmZpZzogSUFwcGxpY2F0aW9uQ29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dnZXIgPSBjcmVhdGVMb2dnZXIoWyBBcHBsaWNhdGlvbi5uYW1lLCBjb25maWcubmFtZSwgY29uZmlnLmVudmlyb25tZW50IF0uam9pbignLScpKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiSW5pdGlhbGl6aW5nIGZ3MjQgaW5mcmFzdHJ1Y3R1cmUuLi5cIik7XG5cbiAgICAgICAgdGhpcy5mdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgICAgICB0aGlzLnVpQ29uZmlnR2VuID0gbmV3IEVudGl0eVVJQ29uZmlnR2VuKCk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25maWcoY29uZmlnKTtcblxuICAgICAgICBpZiAoY29uZmlnLmVudmlyb25tZW50VmFyaWFibGVzKSB7XG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhjb25maWcuZW52aXJvbm1lbnRWYXJpYWJsZXMpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5nbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcykge1xuICAgICAgICAgICAgT2JqZWN0LmVudHJpZXMoY29uZmlnLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKS5mb3JFYWNoKChbIGtleSwgdmFsdWUgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGVuc3VyZSB0aGVyZSdzIGEgbG9nLWxldmVsIHNldCBpbiB0aGUgZncyNCBzY29wZSBzbyB0aGF0IHRoZSBjb25zdHJ1Y3RzIGNhbiBhc2sgZm9yIHRoaXMgdmFsdWVcbiAgICAgICAgLy8gdGhpcydzIG9ubHkgdGhlIGdsb2JhbCB2YWx1ZSwgYW5kIGNhbiBiZSBvdmVycmlkZGVuIGJ5IGVhY2ggbGFtYmRhIGZ1bmN0aW9uLlxuICAgICAgICBpZiAoIXRoaXMuZncyNC5oYXNFbnZpcm9ubWVudFZhcmlhYmxlKCdMT0dfTEVWRUwnKSkge1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcsIHByb2Nlc3MuZW52LkxPR19MRVZFTCB8fCAnSU5GTycpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5jb25zdHJ1Y3RzID0gbmV3IE1hcCgpO1xuICAgICAgICB0aGlzLm1vZHVsZXMgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gaW5pdGlhbGl6ZSB0aGUgbWFpbiBzdGFja1xuICAgICAgICBjb25zdCBhcHAgPSBuZXcgQXBwKCk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRBcHAoYXBwKTtcblxuICAgIH1cblxuICAgIHB1YmxpYyB1c2UoY29uc3RydWN0OiBGVzI0Q29uc3RydWN0KTogQXBwbGljYXRpb24ge1xuICAgICAgICB0aGlzLnJlZ2lzdGVyQ29uc3RydWN0KGNvbnN0cnVjdCk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHB1YmxpYyB1c2VNb2R1bGUobW9kdWxlOiBJRncyNE1vZHVsZSk6IEFwcGxpY2F0aW9uIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDYWxsZWQgVXNlTW9kdWxlIHdpdGggbW9kdWxlOiBcIiwgeyBtb2R1bGVOYW1lOiBtb2R1bGUuZ2V0TmFtZSgpIH0pO1xuXG4gICAgICAgIGlmICh0aGlzLm1vZHVsZXMuaGFzKG1vZHVsZS5nZXROYW1lKCkpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZHVsZSB3aXRoIG5hbWUgJHttb2R1bGUuZ2V0TmFtZSgpfSBpcyBhbHJlYWR5IHJlZ2lzdGVyZWQuYCk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLm1vZHVsZXMuc2V0KG1vZHVsZS5nZXROYW1lKCksIG1vZHVsZSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBbIGNvbnN0cnVjdE5hbWUsIGNvbnN0cnVjdCBdIG9mIG1vZHVsZS5nZXRDb25zdHJ1Y3RzKCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJVc2VNb2R1bGU6IFJlZ2lzdGVyaW5nIGNvbnN0cnVjdDogXCIsIGNvbnN0cnVjdE5hbWUsIG1vZHVsZS5nZXREZXBlbmRlbmNpZXMoKSwgY29uc3RydWN0LmRlcGVuZGVuY2llcyk7XG4gICAgICAgICAgICBjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzID0gbW9kdWxlLmdldERlcGVuZGVuY2llcygpO1xuICAgICAgICAgICAgdGhpcy5yZWdpc3RlckNvbnN0cnVjdChjb25zdHJ1Y3QsIGNvbnN0cnVjdE5hbWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgcnVuKCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiUnVubmluZyBmdzI0IGluZnJhc3RydWN0dXJlLi4uXCIpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBkZWZhdWx0IGZ3MjQgcnVudGltZSBsYXllciAoT05MWSBydW50aW1lIGNvZGUsIG5vdCBpbmZyYXN0cnVjdHVyZSlcbiAgICAgICAgLy8gVGhpcyBsYXllciBpcyBhdXRvbWF0aWNhbGx5IGF0dGFjaGVkIHRvIGFsbCBMYW1iZGEgZnVuY3Rpb25zXG4gICAgICAgIC8vIEl0J3MgTk9UIGFuIGVudHJ5IHBhY2thZ2UgLSBpdCdzIGp1c3QgYXZhaWxhYmxlIGZvciBpbXBvcnRzXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJCdWlsZGluZyBmdzI0IHJ1bnRpbWUgbGF5ZXIuLi5cIik7XG4gICAgICAgIGNvbnN0IGZ3MjRMYXllciA9IG5ldyBMYXllckNvbnN0cnVjdChbIHtcbiAgICAgICAgICAgIG1vZGU6ICdCVUlMRF9BTkRfUEFDS0FHRScsXG4gICAgICAgICAgICAvLyBCdW5kbGUgdGhlIGZ3MjQgcnVudGltZSBzb3VyY2UgKGhhcyBpbXBvcnRzLCBuZWVkcyBidW5kbGluZyB3aXRoIGVzYnVpbGQpXG4gICAgICAgICAgICBzb3VyY2VQYXRoOiAnLi9ub2RlX21vZHVsZXMvQHRlbjI0Z3JvdXAvZncyNC9kaXN0L3BhY2thZ2UvbGF5ZXIvZncyNC5qcycsXG4gICAgICAgICAgICBwYWNrYWdlUGF0aDogJ0B0ZW4yNGdyb3VwL2Z3MjQnLFxuICAgICAgICAgICAgcHJpb3JpdHk6IDAsXG4gICAgICAgICAgICAvLyBPdXRwdXQgdG8gYXBwbGljYXRpb24ncyBkaXN0L2xheWVycyBkaXJlY3RvcnksIG5vdCBmcmFtZXdvcmsncyBkaXJlY3RvcnlcbiAgICAgICAgICAgIGRpc3REaXJlY3Rvcnk6IHBhdGhKb2luKHByb2Nlc3MuY3dkKCksICdkaXN0L2xheWVycycpLFxuICAgICAgICAgICAgYnVpbGRPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgc291cmNlbWFwOiB0cnVlLFxuICAgICAgICAgICAgICAgIGV4dGVybmFsOiBbJ0Bhd3Mtc2RrJywgJ0BzbWl0aHknXSAvLyBBV1MgU0RLIGlzIHByb3ZpZGVkIGJ5IExhbWJkYSBydW50aW1lXG4gICAgICAgICAgICB9XG4gICAgICAgIH0gXSk7XG4gICAgICAgIGZ3MjRMYXllci5jb25zdHJ1Y3QoKTtcblxuICAgICAgICAvLyAqKiogb3JkZXIgaXMgaW1wb3J0YW50IGhlcmUsIG1vZHVsZXMgbmVlZCB0byBiZSBwcm9jZXNzZWQgZmlyc3QsIGJlZm9yZSBjb25zdHJ1Y3RzICoqKlxuICAgICAgICB0aGlzLnByb2Nlc3NNb2R1bGVzKCk7XG5cbiAgICAgICAgY29uc3QgZGlzYWJsZVVJQ29uZmlnR2VuID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldENvbmZpZygpLmRpc2FibGVVSUNvbmZpZ0dlbjtcblxuICAgICAgICBpZiAoIWRpc2FibGVVSUNvbmZpZ0dlbikge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy51aUNvbmZpZ0dlbi5ydW4oKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNvbmZpZ3VyZSBhIGJ1aWxkIGNvbW1hbmQgbGlrZSBpbiBwYWNrYWdlLmpzb24gdG8gb25seSBnZW5lcmF0ZSB0aGUgdWkgY29uZmlnXG4gICAgICAgIC8vIFwidWk6Z2VuXCI6IFwiVUlfR0VOX09OTFk9dHJ1ZSBlbnYtY21kIC1mIC5lbnYubG9jYWwgdHMtbm9kZSBzcmMvaW5kZXgudHNcIlxuICAgICAgICAvLyB0aGlzIGlzIHVzZWZ1bCBmb3IgZ2VuZXJhdGluZyB0aGUgdWkgY29uZmlnIGR1cmluZyBkZXZlbG9wbWVudFxuICAgICAgICBpZiAocHJvY2Vzcy5lbnYuVUlfR0VOX09OTFkgPT09ICd0cnVlJykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnVUkgY29uZmlnIGdlbmVyYXRpb24gY29tcGxldGUuIEV4aXRpbmcuJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLmNvbnN0cnVjdEFsbFJlc291cmNlcygpXG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnQWxsIGNvbnN0cnVjdCByZXNvdXJjZSBjcmVhdGlvbiBjb21wbGV0ZWQnKTtcbiAgICB9XG5cblxuICAgIHByaXZhdGUgcmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0OiBGVzI0Q29uc3RydWN0LCBuYW1lPzogc3RyaW5nKSB7XG4gICAgICAgIGxldCBjb25zdHJ1Y3ROYW1lID0gbmFtZSB8fCBjb25zdHJ1Y3QubmFtZTtcbiAgICAgICAgaWYgKHRoaXMuY29uc3RydWN0cy5oYXMoY29uc3RydWN0TmFtZSkpIHtcbiAgICAgICAgICAgIC8vIGhhbmRsZSBtdWx0aXBsZSBjb25zdHJ1Y3RzIG9mIHNhbWUgdHlwZVxuICAgICAgICAgICAgY29uc3QgbmV3Q29uc3RydWN0TmFtZSA9IGNvbnN0cnVjdE5hbWUuY29uY2F0KCctJywgcmFuZG9tVVVJRCgpKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbnN0cnVjdCB3aXRoIG5hbWUgJHtjb25zdHJ1Y3ROYW1lfSBpcyBhbHJlYWR5IHJlZ2lzdGVyZWQsIHJlbmFtaW5nIHRvICR7bmV3Q29uc3RydWN0TmFtZX1gKTtcbiAgICAgICAgICAgIGNvbnN0cnVjdE5hbWUgPSBuZXdDb25zdHJ1Y3ROYW1lO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY29uc3RydWN0cy5zZXQoY29uc3RydWN0TmFtZSwgY29uc3RydWN0KTtcbiAgICAgICAgdGhpcy5mdzI0LmFkZENvbnN0cnVjdChjb25zdHJ1Y3QpO1xuICAgIH1cblxuICAgIHByaXZhdGUgcHJvY2Vzc01vZHVsZXMoKSB7XG4gICAgICAgIGZvciAoY29uc3QgWyBtb2R1bGVOYW1lLCBtb2R1bGUgXSBvZiB0aGlzLm1vZHVsZXMpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5hZGRNb2R1bGUobW9kdWxlTmFtZSwgbW9kdWxlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgY29uc3RydWN0QWxsUmVzb3VyY2VzKCkge1xuICAgICAgICBjb25zdCBhbGxDb25zdHJ1Y3RzID0gQXJyYXkuZnJvbSh0aGlzLmNvbnN0cnVjdHMua2V5cygpKS5tYXAoY29uc3RydWN0TmFtZSA9PiB0aGlzLmNvbnN0cnVjdFJlc291cmNlcyhjb25zdHJ1Y3ROYW1lKSk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChhbGxDb25zdHJ1Y3RzKTtcbiAgICB9XG5cbiAgICBhc3luYyBjb25zdHJ1Y3RSZXNvdXJjZXMoY29uc3RydWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGNvbnN0cnVjdCA9IHRoaXMuY29uc3RydWN0cy5nZXQoY29uc3RydWN0TmFtZSk7XG4gICAgICAgIGlmICghY29uc3RydWN0KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnN0cnVjdCAke2NvbnN0cnVjdE5hbWV9IG5vdCBmb3VuZGApO1xuICAgICAgICB9XG5cbiAgICAgICAgd2hpbGUgKHRoaXMucmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3kgPj0gdGhpcy5yZXNvdXJjZUNvbnN0cnVjdE1heENvbmN1cnJlbmN5KSB7XG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwKSk7IC8vIFRocm90dGxlIGlmIGNvbmN1cnJlbmN5IGxpbWl0IGlzIHJlYWNoZWRcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFByb2Nlc3NpbmcgY29uc3RydWN0ICR7Y29uc3RydWN0TmFtZX0uLi5gKTtcblxuICAgICAgICAvLyBXYWl0IGZvciBkZXBlbmRlbmNpZXMgdG8gcmVzb2x2ZVxuICAgICAgICBhd2FpdCB0aGlzLndhaXRGb3JEZXBlbmRlbmNpZXMoY29uc3RydWN0LmRlcGVuZGVuY2llcywgY29uc3RydWN0TmFtZSk7XG5cbiAgICAgICAgdGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSsrO1xuICAgICAgICBjb25zdCBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IGNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTdWNjZXNzZnVsbHkgY29tcGxldGVkIGNvbnN0cnVjdCAke2NvbnN0cnVjdE5hbWV9YCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gY29uc3RydWN0ICR7Y29uc3RydWN0TmFtZX06YCwgZXJyb3IpO1xuICAgICAgICAgICAgICAgIHRocm93IGVycm9yOyAvLyBSZS10aHJvdyB0byBlbnN1cmUgZGVwbG95bWVudCBmYWlsc1xuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5LS07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKCk7XG5cbiAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZSk7XG4gICAgICAgIHJldHVybiBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHdhaXRGb3JEZXBlbmRlbmNpZXMoZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSwgY29uc3RydWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gZGVwZW5kZW5jaWVzLm1hcChkZXBlbmRlbmN5ID0+IHtcbiAgICAgICAgICAgIC8vIGlmIGRlcGVuZGVuY3kgY29uc3RydWN0IGRvZXMgbm90IGV4aXN0cyBpbiB0aGUgY29uc3RydWN0IGxpc3QsIG1hcmsgaXQgYXMgcHJvY2Vzc2VkXG4gICAgICAgICAgICBpZiAoIXRoaXMuY29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBEZXBlbmRlbmN5IGNvbnN0cnVjdCAke2RlcGVuZGVuY3l9IG5vdCBmb3VuZCwgbWFya2luZyBpdCByZXNvbHZlZC5gKTtcbiAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuc2V0KGRlcGVuZGVuY3ksIFByb21pc2UucmVzb2x2ZSgpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmhhcyhkZXBlbmRlbmN5KSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbnN0cnVjdCAke2NvbnN0cnVjdE5hbWV9OiBXYWl0aW5nIGZvciBkZXBlbmRlbmN5IHRvIGJlIHJlc29sdmVkICR7ZGVwZW5kZW5jeX0uLi5gKTtcbiAgICAgICAgICAgICAgICAvLyBJZiBkZXBlbmRlbmN5IG5vdCBzY2hlZHVsZWQgeWV0LCBsaXN0ZW4gZm9yIGl0cyBhZGRpdGlvblxuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGVhckludGVydmFsKGludGVydmFsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuZ2V0KGRlcGVuZGVuY3kpIS50aGVuKHJlc29sdmUsIHJlamVjdCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29uc3RydWN0ICR7Y29uc3RydWN0TmFtZX06IERlcGVuZGVuY3kgJHtkZXBlbmRlbmN5fSByZXNvbHZlZC5gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSwgMTAwKTsgLy8gQ2hlY2sgZXZlcnkgMTAwbXNcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuZ2V0KGRlcGVuZGVuY3kpITtcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcbiAgICB9XG5cbn1cbiJdfQ==