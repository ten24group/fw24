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
        // Apply global policies from config
        if (config.globalPolicies) {
            config.globalPolicies.forEach(policy => {
                this.fw24.addGlobalPolicy(policy);
            });
        }
        // Apply global resource access from config
        if (config.globalResourceAccess) {
            this.fw24.setGlobalResourceAccess(config.globalResourceAccess);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsNkNBQXlDO0FBQ3pDLHNDQUFtQztBQUluQywrRUFBeUU7QUFDekUsdUNBQStEO0FBQy9ELDZDQUE4QztBQUM5QyxtQ0FBZ0M7QUFDaEMsNkNBQXlDO0FBQ3pDLHlDQUE2QztBQUU3QyxNQUFhLFdBQVc7SUFDWCxNQUFNLENBQVU7SUFDekIsU0FBUyxDQUFTO0lBRUYsSUFBSSxDQUFPO0lBQ1gsV0FBVyxDQUFvQjtJQUM5QixVQUFVLENBQTZCO0lBQ3ZDLE9BQU8sQ0FBMkI7SUFDbEMsbUJBQW1CLEdBQStCLElBQUksR0FBRyxFQUFFLENBQUM7SUFDNUQsK0JBQStCLEdBQVcsRUFBRSxDQUFDO0lBQ3RELG1DQUFtQyxHQUFHLENBQUMsQ0FBQztJQUVoRCxZQUFZLFNBQTZCLEVBQUU7UUFDdkMsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsQ0FBRSxXQUFXLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLFdBQVcsQ0FBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBRTVGLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHFDQUFxQyxDQUFDLENBQUM7UUFFeEQsSUFBSSxDQUFDLElBQUksR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDL0IsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLHdDQUFpQixFQUFFLENBQUM7UUFDM0MsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFNUIsSUFBSSxNQUFNLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztZQUM5QixNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLE9BQU8sQ0FB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QUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7d0JBQ3BFLENBQUM7b0JBQ0wsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsb0JBQW9CO2dCQUNqQyxDQUFDLENBQUMsQ0FBQztZQUNQLENBQUM7WUFDRCxPQUFPLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFFLENBQUM7UUFDckQsQ0FBQyxDQUFDLENBQUM7UUFDSCxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDaEMsQ0FBQztDQUVKO0FBak9ELGtDQWlPQztBQTdJZ0I7SUFEWixJQUFBLHFCQUFXLEdBQUU7c0NBbURiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQXBwLCBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgSUFwcGxpY2F0aW9uQ29uZmlnIH0gZnJvbSBcIi4vaW50ZXJmYWNlcy9jb25maWdcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QgfSBmcm9tIFwiLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgSUZ3MjRNb2R1bGUgfSBmcm9tIFwiLi9jb3JlL3J1bnRpbWUvbW9kdWxlXCI7XG5pbXBvcnQgeyBFbnRpdHlVSUNvbmZpZ0dlbiB9IGZyb20gXCIuL3VpLWNvbmZpZy1nZW4vZW50aXR5LXVpLWNvbmZpZy5nZW5cIjtcbmltcG9ydCB7IElMb2dnZXIsIExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBMYXllckNvbnN0cnVjdCB9IGZyb20gXCIuL2NvbnN0cnVjdHNcIjtcbmltcG9ydCB7IFRpbWVyIH0gZnJvbSBcIi4vdXRpbHNcIjtcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgeyBqb2luIGFzIHBhdGhKb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IGNsYXNzIEFwcGxpY2F0aW9uIHtcbiAgICByZWFkb25seSBsb2dnZXI6IElMb2dnZXI7XG4gICAgbWFpblN0YWNrITogU3RhY2s7XG5cbiAgICBwdWJsaWMgcmVhZG9ubHkgZncyNDogRncyNDtcbiAgICBwdWJsaWMgcmVhZG9ubHkgdWlDb25maWdHZW46IEVudGl0eVVJQ29uZmlnR2VuO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY29uc3RydWN0czogTWFwPHN0cmluZywgRlcyNENvbnN0cnVjdD47XG4gICAgcHJpdmF0ZSByZWFkb25seSBtb2R1bGVzOiBNYXA8c3RyaW5nLCBJRncyNE1vZHVsZT47XG4gICAgcHJpdmF0ZSByZWFkb25seSBwcm9jZXNzZWRDb25zdHJ1Y3RzOiBNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+PiA9IG5ldyBNYXAoKTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJlc291cmNlQ29uc3RydWN0TWF4Q29uY3VycmVuY3k6IG51bWJlciA9IDEwO1xuICAgIHByaXZhdGUgcmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3kgPSAwO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnOiBJQXBwbGljYXRpb25Db25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihbIEFwcGxpY2F0aW9uLm5hbWUsIGNvbmZpZy5uYW1lLCBjb25maWcuZW52aXJvbm1lbnQgXS5qb2luKCctJykpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJJbml0aWFsaXppbmcgZncyNCBpbmZyYXN0cnVjdHVyZS4uLlwiKTtcblxuICAgICAgICB0aGlzLmZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgICAgIHRoaXMudWlDb25maWdHZW4gPSBuZXcgRW50aXR5VUlDb25maWdHZW4oKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbmZpZyhjb25maWcpO1xuXG4gICAgICAgIGlmIChjb25maWcuZW52aXJvbm1lbnRWYXJpYWJsZXMpIHtcbiAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKGNvbmZpZy5lbnZpcm9ubWVudFZhcmlhYmxlcykuZm9yRWFjaCgoWyBrZXksIHZhbHVlIF0pID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKSB7XG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhjb25maWcuZ2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXBwbHkgZ2xvYmFsIHBvbGljaWVzIGZyb20gY29uZmlnXG4gICAgICAgIGlmIChjb25maWcuZ2xvYmFsUG9saWNpZXMpIHtcbiAgICAgICAgICAgIGNvbmZpZy5nbG9iYWxQb2xpY2llcy5mb3JFYWNoKHBvbGljeSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LmFkZEdsb2JhbFBvbGljeShwb2xpY3kpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBcHBseSBnbG9iYWwgcmVzb3VyY2UgYWNjZXNzIGZyb20gY29uZmlnXG4gICAgICAgIGlmIChjb25maWcuZ2xvYmFsUmVzb3VyY2VBY2Nlc3MpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRHbG9iYWxSZXNvdXJjZUFjY2Vzcyhjb25maWcuZ2xvYmFsUmVzb3VyY2VBY2Nlc3MpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gZW5zdXJlIHRoZXJlJ3MgYSBsb2ctbGV2ZWwgc2V0IGluIHRoZSBmdzI0IHNjb3BlIHNvIHRoYXQgdGhlIGNvbnN0cnVjdHMgY2FuIGFzayBmb3IgdGhpcyB2YWx1ZVxuICAgICAgICAvLyB0aGlzJ3Mgb25seSB0aGUgZ2xvYmFsIHZhbHVlLCBhbmQgY2FuIGJlIG92ZXJyaWRkZW4gYnkgZWFjaCBsYW1iZGEgZnVuY3Rpb24uXG4gICAgICAgIGlmICghdGhpcy5mdzI0Lmhhc0Vudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcpKSB7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnTE9HX0xFVkVMJywgcHJvY2Vzcy5lbnYuTE9HX0xFVkVMIHx8ICdJTkZPJyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmNvbnN0cnVjdHMgPSBuZXcgTWFwKCk7XG4gICAgICAgIHRoaXMubW9kdWxlcyA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBpbml0aWFsaXplIHRoZSBtYWluIHN0YWNrXG4gICAgICAgIGNvbnN0IGFwcCA9IG5ldyBBcHAoKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldEFwcChhcHApO1xuXG4gICAgfVxuXG4gICAgcHVibGljIHVzZShjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QpOiB0aGlzIHtcbiAgICAgICAgdGhpcy5yZWdpc3RlckNvbnN0cnVjdChjb25zdHJ1Y3QpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBwdWJsaWMgdXNlTW9kdWxlKG1vZHVsZTogSUZ3MjRNb2R1bGUpOiB0aGlzIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDYWxsZWQgVXNlTW9kdWxlIHdpdGggbW9kdWxlOiBcIiwgeyBtb2R1bGVOYW1lOiBtb2R1bGUuZ2V0TmFtZSgpIH0pO1xuXG4gICAgICAgIGlmICh0aGlzLm1vZHVsZXMuaGFzKG1vZHVsZS5nZXROYW1lKCkpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZHVsZSB3aXRoIG5hbWUgJHttb2R1bGUuZ2V0TmFtZSgpfSBpcyBhbHJlYWR5IHJlZ2lzdGVyZWQuYCk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLm1vZHVsZXMuc2V0KG1vZHVsZS5nZXROYW1lKCksIG1vZHVsZSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBbIGNvbnN0cnVjdE5hbWUsIGNvbnN0cnVjdCBdIG9mIG1vZHVsZS5nZXRDb25zdHJ1Y3RzKCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJVc2VNb2R1bGU6IFJlZ2lzdGVyaW5nIGNvbnN0cnVjdDogXCIsIGNvbnN0cnVjdE5hbWUsIG1vZHVsZS5nZXREZXBlbmRlbmNpZXMoKSwgY29uc3RydWN0LmRlcGVuZGVuY2llcyk7XG4gICAgICAgICAgICBjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzID0gbW9kdWxlLmdldERlcGVuZGVuY2llcygpO1xuICAgICAgICAgICAgdGhpcy5yZWdpc3RlckNvbnN0cnVjdChjb25zdHJ1Y3QsIGNvbnN0cnVjdE5hbWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgcnVuKCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiUnVubmluZyBmdzI0IGluZnJhc3RydWN0dXJlLi4uXCIpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBkZWZhdWx0IGZ3MjQgcnVudGltZSBsYXllciAoT05MWSBydW50aW1lIGNvZGUsIG5vdCBpbmZyYXN0cnVjdHVyZSlcbiAgICAgICAgLy8gVGhpcyBsYXllciBpcyBhdXRvbWF0aWNhbGx5IGF0dGFjaGVkIHRvIGFsbCBMYW1iZGEgZnVuY3Rpb25zXG4gICAgICAgIC8vIEl0J3MgTk9UIGFuIGVudHJ5IHBhY2thZ2UgLSBpdCdzIGp1c3QgYXZhaWxhYmxlIGZvciBpbXBvcnRzXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJCdWlsZGluZyBmdzI0IHJ1bnRpbWUgbGF5ZXIuLi5cIik7XG4gICAgICAgIGNvbnN0IGZ3MjRMYXllciA9IG5ldyBMYXllckNvbnN0cnVjdChbIHtcbiAgICAgICAgICAgIG1vZGU6ICdCVUlMRF9BTkRfUEFDS0FHRScsXG4gICAgICAgICAgICAvLyBCdW5kbGUgdGhlIGZ3MjQgcnVudGltZSBzb3VyY2UgKGhhcyBpbXBvcnRzLCBuZWVkcyBidW5kbGluZyB3aXRoIGVzYnVpbGQpXG4gICAgICAgICAgICBzb3VyY2VQYXRoOiAnLi9ub2RlX21vZHVsZXMvQHRlbjI0Z3JvdXAvZncyNC9kaXN0L3BhY2thZ2UvbGF5ZXIvZncyNC5qcycsXG4gICAgICAgICAgICBwYWNrYWdlUGF0aDogJ0B0ZW4yNGdyb3VwL2Z3MjQnLFxuICAgICAgICAgICAgcHJpb3JpdHk6IDAsXG4gICAgICAgICAgICAvLyBPdXRwdXQgdG8gYXBwbGljYXRpb24ncyBkaXN0L2xheWVycyBkaXJlY3RvcnksIG5vdCBmcmFtZXdvcmsncyBkaXJlY3RvcnlcbiAgICAgICAgICAgIGRpc3REaXJlY3Rvcnk6IHBhdGhKb2luKHByb2Nlc3MuY3dkKCksICdkaXN0L2xheWVycycpLFxuICAgICAgICAgICAgYnVpbGRPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgc291cmNlbWFwOiB0cnVlLFxuICAgICAgICAgICAgICAgIGV4dGVybmFsOiBbICdAYXdzLXNkaycsICdAc21pdGh5JyBdIC8vIEFXUyBTREsgaXMgTk9UIHByb3ZpZGVkIGJ5IExhbWJkYSBydW50aW1lXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaXNFbnRyeVBhY2thZ2U6IGZhbHNlLFxuICAgICAgICB9IF0pO1xuICAgICAgICBhd2FpdCBmdzI0TGF5ZXIuY29uc3RydWN0KCk7XG5cbiAgICAgICAgLy8gKioqIG9yZGVyIGlzIGltcG9ydGFudCBoZXJlLCBtb2R1bGVzIG5lZWQgdG8gYmUgcHJvY2Vzc2VkIGZpcnN0LCBiZWZvcmUgY29uc3RydWN0cyAqKipcbiAgICAgICAgdGhpcy5wcm9jZXNzTW9kdWxlcygpO1xuXG4gICAgICAgIGNvbnN0IGRpc2FibGVVSUNvbmZpZ0dlbiA9IEZ3MjQuZ2V0SW5zdGFuY2UoKS5nZXRDb25maWcoKS5kaXNhYmxlVUlDb25maWdHZW47XG5cbiAgICAgICAgaWYgKCFkaXNhYmxlVUlDb25maWdHZW4pIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMudWlDb25maWdHZW4ucnVuKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjb25maWd1cmUgYSBidWlsZCBjb21tYW5kIGxpa2UgaW4gcGFja2FnZS5qc29uIHRvIG9ubHkgZ2VuZXJhdGUgdGhlIHVpIGNvbmZpZ1xuICAgICAgICAvLyBcInVpOmdlblwiOiBcIlVJX0dFTl9PTkxZPXRydWUgZW52LWNtZCAtZiAuZW52LmxvY2FsIHRzLW5vZGUgc3JjL2luZGV4LnRzXCJcbiAgICAgICAgLy8gdGhpcyBpcyB1c2VmdWwgZm9yIGdlbmVyYXRpbmcgdGhlIHVpIGNvbmZpZyBkdXJpbmcgZGV2ZWxvcG1lbnRcbiAgICAgICAgaWYgKHByb2Nlc3MuZW52LlVJX0dFTl9PTkxZID09PSAndHJ1ZScpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1VJIGNvbmZpZyBnZW5lcmF0aW9uIGNvbXBsZXRlLiBFeGl0aW5nLicpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdG90YWxDb25zdHJ1Y3RzID0gdGhpcy5jb25zdHJ1Y3RzLnNpemU7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCR7Jz0nLnJlcGVhdCg2MCl9YCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCfmoAgQnVpbGRpbmcgJHt0b3RhbENvbnN0cnVjdHN9IGNvbnN0cnVjdChzKS4uLmApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfVxcbmApO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuY29uc3RydWN0QWxsUmVzb3VyY2VzKClcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfWApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgQWxsIGNvbnN0cnVjdHMgY29tcGxldGVkIHN1Y2Nlc3NmdWxseWApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfVxcbmApO1xuICAgIH1cblxuXG4gICAgcHJpdmF0ZSByZWdpc3RlckNvbnN0cnVjdChjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QsIG5hbWU/OiBzdHJpbmcpIHtcbiAgICAgICAgbGV0IGNvbnN0cnVjdE5hbWUgPSBuYW1lIHx8IGNvbnN0cnVjdC5uYW1lO1xuICAgICAgICBpZiAodGhpcy5jb25zdHJ1Y3RzLmhhcyhjb25zdHJ1Y3ROYW1lKSkge1xuICAgICAgICAgICAgLy8gaGFuZGxlIG11bHRpcGxlIGNvbnN0cnVjdHMgb2Ygc2FtZSB0eXBlXG4gICAgICAgICAgICBjb25zdCBuZXdDb25zdHJ1Y3ROYW1lID0gY29uc3RydWN0TmFtZS5jb25jYXQoJy0nLCByYW5kb21VVUlEKCkpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29uc3RydWN0IHdpdGggbmFtZSAke2NvbnN0cnVjdE5hbWV9IGlzIGFscmVhZHkgcmVnaXN0ZXJlZCwgcmVuYW1pbmcgdG8gJHtuZXdDb25zdHJ1Y3ROYW1lfWApO1xuICAgICAgICAgICAgY29uc3RydWN0TmFtZSA9IG5ld0NvbnN0cnVjdE5hbWU7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5jb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3QpO1xuICAgICAgICB0aGlzLmZ3MjQuYWRkQ29uc3RydWN0KGNvbnN0cnVjdCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBwcm9jZXNzTW9kdWxlcygpIHtcbiAgICAgICAgZm9yIChjb25zdCBbIG1vZHVsZU5hbWUsIG1vZHVsZSBdIG9mIHRoaXMubW9kdWxlcykge1xuICAgICAgICAgICAgdGhpcy5mdzI0LmFkZE1vZHVsZShtb2R1bGVOYW1lLCBtb2R1bGUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjb25zdHJ1Y3RBbGxSZXNvdXJjZXMoKSB7XG4gICAgICAgIGNvbnN0IGFsbENvbnN0cnVjdHMgPSBBcnJheS5mcm9tKHRoaXMuY29uc3RydWN0cy5rZXlzKCkpLm1hcChjb25zdHJ1Y3ROYW1lID0+IHRoaXMuY29uc3RydWN0UmVzb3VyY2VzKGNvbnN0cnVjdE5hbWUpKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKGFsbENvbnN0cnVjdHMpO1xuICAgIH1cblxuICAgIGFzeW5jIGNvbnN0cnVjdFJlc291cmNlcyhjb25zdHJ1Y3ROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgY29uc3RydWN0ID0gdGhpcy5jb25zdHJ1Y3RzLmdldChjb25zdHJ1Y3ROYW1lKTtcbiAgICAgICAgaWYgKCFjb25zdHJ1Y3QpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29uc3RydWN0ICR7Y29uc3RydWN0TmFtZX0gbm90IGZvdW5kYCk7XG4gICAgICAgIH1cblxuICAgICAgICB3aGlsZSAodGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSA+PSB0aGlzLnJlc291cmNlQ29uc3RydWN0TWF4Q29uY3VycmVuY3kpIHtcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDApKTsgLy8gVGhyb3R0bGUgaWYgY29uY3VycmVuY3kgbGltaXQgaXMgcmVhY2hlZFxuICAgICAgICB9XG5cbiAgICAgICAgLy8gT25seSBsb2cgaWYgdGhlcmUgYXJlIGFjdHVhbCBkZXBlbmRlbmNpZXNcbiAgICAgICAgaWYgKGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMgJiYgY29uc3RydWN0LmRlcGVuZGVuY2llcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhg4o+zICR7Y29uc3RydWN0TmFtZX06IFdhaXRpbmcgZm9yIGRlcGVuZGVuY2llczogJHtjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBXYWl0IGZvciBkZXBlbmRlbmNpZXMgdG8gcmVzb2x2ZVxuICAgICAgICBhd2FpdCB0aGlzLndhaXRGb3JEZXBlbmRlbmNpZXMoY29uc3RydWN0LmRlcGVuZGVuY2llcywgY29uc3RydWN0TmFtZSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg8J+UqCBCdWlsZGluZyAke2NvbnN0cnVjdE5hbWV9Li4uYCk7XG5cbiAgICAgICAgdGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSsrO1xuICAgICAgICBjb25zdCB0aW1lciA9IFRpbWVyLnN0YXJ0KCk7XG4gICAgICAgIGNvbnN0IGNvbnN0cnVjdENvbXBsZXRpb25Qcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgY29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSAke2NvbnN0cnVjdE5hbWV9IGNvbXBsZXRlZCBpbiAke3RpbWVyLmVsYXBzZWRTZWNvbmRzKCl9YCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGDinYwgJHtjb25zdHJ1Y3ROYW1lfSBmYWlsZWQ6YCwgZXJyb3IpO1xuICAgICAgICAgICAgICAgIHRocm93IGVycm9yOyAvLyBSZS10aHJvdyB0byBlbnN1cmUgZGVwbG95bWVudCBmYWlsc1xuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5LS07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKCk7XG5cbiAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZSk7XG4gICAgICAgIHJldHVybiBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHdhaXRGb3JEZXBlbmRlbmNpZXMoZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSwgY29uc3RydWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghZGVwZW5kZW5jaWVzIHx8IGRlcGVuZGVuY2llcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gZGVwZW5kZW5jaWVzLm1hcChkZXBlbmRlbmN5ID0+IHtcbiAgICAgICAgICAgIC8vIGlmIGRlcGVuZGVuY3kgY29uc3RydWN0IGRvZXMgbm90IGV4aXN0cyBpbiB0aGUgY29uc3RydWN0IGxpc3QsIG1hcmsgaXQgYXMgcHJvY2Vzc2VkXG4gICAgICAgICAgICBpZiAoIXRoaXMuY29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtjb25zdHJ1Y3ROYW1lfTogRGVwZW5kZW5jeSAke2RlcGVuZGVuY3l9IG5vdCByZWdpc3RlcmVkIChvcHRpb25hbCBkZXBlbmRlbmN5KWApO1xuICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5zZXQoZGVwZW5kZW5jeSwgUHJvbWlzZS5yZXNvbHZlKCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCF0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgLy8gSWYgZGVwZW5kZW5jeSBub3Qgc2NoZWR1bGVkIHlldCwgbGlzdGVuIGZvciBpdHMgYWRkaXRpb25cbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJJbnRlcnZhbChpbnRlcnZhbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmdldChkZXBlbmRlbmN5KSEudGhlbihyZXNvbHZlLCByZWplY3QpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LCAxMDApOyAvLyBDaGVjayBldmVyeSAxMDBtc1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5nZXQoZGVwZW5kZW5jeSkhO1xuICAgICAgICB9KTtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICAgIH1cblxufVxuIl19