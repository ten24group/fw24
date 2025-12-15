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
        // Build user-defined layers BEFORE any other constructs
        // This ensures layers and entry packages are available for any lambdas created by any construct
        await this.buildUserLayers();
        const totalConstructs = this.constructs.size;
        this.logger.info(`${'='.repeat(60)}`);
        this.logger.info(`🚀 Building ${totalConstructs} construct(s)...`);
        this.logger.info(`${'='.repeat(60)}\n`);
        await this.constructAllResources();
        this.logger.info(`${'='.repeat(60)}`);
        this.logger.info(`✅ All constructs completed successfully`);
        this.logger.info(`${'='.repeat(60)}\n`);
    }
    /**
     * Build user-defined layer constructs before other constructs.
     * This ensures entry packages are registered before any lambdas are created.
     */
    async buildUserLayers() {
        const layerConstructs = Array.from(this.constructs.entries())
            .filter(([_, construct]) => construct.name === 'LayerConstruct')
            .map(([name]) => name);
        if (layerConstructs.length === 0) {
            return;
        }
        this.logger.info(`Building ${layerConstructs.length} user layer(s) first...`);
        for (const constructName of layerConstructs) {
            await this.constructResources(constructName);
        }
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
        // Check if already processed or in progress - prevent duplicate builds
        if (this.processedConstructs.has(constructName)) {
            return this.processedConstructs.get(constructName);
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsNkNBQXlDO0FBQ3pDLHNDQUFtQztBQUluQywrRUFBeUU7QUFDekUsdUNBQStEO0FBQy9ELDZDQUE4QztBQUM5QyxtQ0FBZ0M7QUFDaEMsNkNBQXlDO0FBQ3pDLHlDQUE2QztBQUU3QyxNQUFhLFdBQVc7SUFDWCxNQUFNLENBQVU7SUFDekIsU0FBUyxDQUFTO0lBRUYsSUFBSSxDQUFPO0lBQ1gsV0FBVyxDQUFvQjtJQUM5QixVQUFVLENBQTZCO0lBQ3ZDLE9BQU8sQ0FBMkI7SUFDbEMsbUJBQW1CLEdBQStCLElBQUksR0FBRyxFQUFFLENBQUM7SUFDNUQsK0JBQStCLEdBQVcsRUFBRSxDQUFDO0lBQ3RELG1DQUFtQyxHQUFHLENBQUMsQ0FBQztJQUVoRCxZQUFZLFNBQTZCLEVBQUU7UUFDdkMsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsQ0FBRSxXQUFXLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLFdBQVcsQ0FBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBRTVGLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHFDQUFxQyxDQUFDLENBQUM7UUFFeEQsSUFBSSxDQUFDLElBQUksR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDL0IsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLHdDQUFpQixFQUFFLENBQUM7UUFDM0MsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFNUIsSUFBSSxNQUFNLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztZQUM5QixNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLE9BQU8sQ0FB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LENBQUMsQ0FBQztRQUNILE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUNoQyxDQUFDO0NBRUo7QUEvUEQsa0NBK1BDO0FBM0tnQjtJQURaLElBQUEscUJBQVcsR0FBRTtzQ0F3RGIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBcHAsIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBJQXBwbGljYXRpb25Db25maWcgfSBmcm9tIFwiLi9pbnRlcmZhY2VzL2NvbmZpZ1wiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCB9IGZyb20gXCIuL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBJRncyNE1vZHVsZSB9IGZyb20gXCIuL2NvcmUvcnVudGltZS9tb2R1bGVcIjtcbmltcG9ydCB7IEVudGl0eVVJQ29uZmlnR2VuIH0gZnJvbSBcIi4vdWktY29uZmlnLWdlbi9lbnRpdHktdWktY29uZmlnLmdlblwiO1xuaW1wb3J0IHsgSUxvZ2dlciwgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuL2xvZ2dpbmdcIjtcbmltcG9ydCB7IExheWVyQ29uc3RydWN0IH0gZnJvbSBcIi4vY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgVGltZXIgfSBmcm9tIFwiLi91dGlsc1wiO1xuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ25vZGU6Y3J5cHRvJztcbmltcG9ydCB7IGpvaW4gYXMgcGF0aEpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5leHBvcnQgY2xhc3MgQXBwbGljYXRpb24ge1xuICAgIHJlYWRvbmx5IGxvZ2dlcjogSUxvZ2dlcjtcbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIHB1YmxpYyByZWFkb25seSBmdzI0OiBGdzI0O1xuICAgIHB1YmxpYyByZWFkb25seSB1aUNvbmZpZ0dlbjogRW50aXR5VUlDb25maWdHZW47XG4gICAgcHJpdmF0ZSByZWFkb25seSBjb25zdHJ1Y3RzOiBNYXA8c3RyaW5nLCBGVzI0Q29uc3RydWN0PjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IG1vZHVsZXM6IE1hcDxzdHJpbmcsIElGdzI0TW9kdWxlPjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHByb2Nlc3NlZENvbnN0cnVjdHM6IE1hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+ID0gbmV3IE1hcCgpO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVzb3VyY2VDb25zdHJ1Y3RNYXhDb25jdXJyZW5jeTogbnVtYmVyID0gMTA7XG4gICAgcHJpdmF0ZSByZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSA9IDA7XG5cbiAgICBjb25zdHJ1Y3Rvcihjb25maWc6IElBcHBsaWNhdGlvbkNvbmZpZyA9IHt9KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyID0gY3JlYXRlTG9nZ2VyKFsgQXBwbGljYXRpb24ubmFtZSwgY29uZmlnLm5hbWUsIGNvbmZpZy5lbnZpcm9ubWVudCBdLmpvaW4oJy0nKSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkluaXRpYWxpemluZyBmdzI0IGluZnJhc3RydWN0dXJlLi4uXCIpO1xuXG4gICAgICAgIHRoaXMuZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICAgICAgdGhpcy51aUNvbmZpZ0dlbiA9IG5ldyBFbnRpdHlVSUNvbmZpZ0dlbigpO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uZmlnKGNvbmZpZyk7XG5cbiAgICAgICAgaWYgKGNvbmZpZy5lbnZpcm9ubWVudFZhcmlhYmxlcykge1xuICAgICAgICAgICAgT2JqZWN0LmVudHJpZXMoY29uZmlnLmVudmlyb25tZW50VmFyaWFibGVzKS5mb3JFYWNoKChbIGtleSwgdmFsdWUgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjb25maWcuZ2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMpIHtcbiAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKGNvbmZpZy5nbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcykuZm9yRWFjaCgoWyBrZXksIHZhbHVlIF0pID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0R2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICAvLyBBcHBseSBnbG9iYWwgcG9saWNpZXMgZnJvbSBjb25maWdcbiAgICAgICAgaWYgKGNvbmZpZy5nbG9iYWxQb2xpY2llcykge1xuICAgICAgICAgICAgY29uZmlnLmdsb2JhbFBvbGljaWVzLmZvckVhY2gocG9saWN5ID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsUG9saWN5KHBvbGljeSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFwcGx5IGdsb2JhbCByZXNvdXJjZSBhY2Nlc3MgZnJvbSBjb25maWdcbiAgICAgICAgaWYgKGNvbmZpZy5nbG9iYWxSZXNvdXJjZUFjY2Vzcykge1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbFJlc291cmNlQWNjZXNzKGNvbmZpZy5nbG9iYWxSZXNvdXJjZUFjY2Vzcyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBlbnN1cmUgdGhlcmUncyBhIGxvZy1sZXZlbCBzZXQgaW4gdGhlIGZ3MjQgc2NvcGUgc28gdGhhdCB0aGUgY29uc3RydWN0cyBjYW4gYXNrIGZvciB0aGlzIHZhbHVlXG4gICAgICAgIC8vIHRoaXMncyBvbmx5IHRoZSBnbG9iYWwgdmFsdWUsIGFuZCBjYW4gYmUgb3ZlcnJpZGRlbiBieSBlYWNoIGxhbWJkYSBmdW5jdGlvbi5cbiAgICAgICAgaWYgKCF0aGlzLmZ3MjQuaGFzRW52aXJvbm1lbnRWYXJpYWJsZSgnTE9HX0xFVkVMJykpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdMT0dfTEVWRUwnLCBwcm9jZXNzLmVudi5MT0dfTEVWRUwgfHwgJ0lORk8nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuY29uc3RydWN0cyA9IG5ldyBNYXAoKTtcbiAgICAgICAgdGhpcy5tb2R1bGVzID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIGluaXRpYWxpemUgdGhlIG1haW4gc3RhY2tcbiAgICAgICAgY29uc3QgYXBwID0gbmV3IEFwcCgpO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0QXBwKGFwcCk7XG5cbiAgICB9XG5cbiAgICBwdWJsaWMgdXNlKGNvbnN0cnVjdDogRlcyNENvbnN0cnVjdCk6IHRoaXMge1xuICAgICAgICB0aGlzLnJlZ2lzdGVyQ29uc3RydWN0KGNvbnN0cnVjdCk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHB1YmxpYyB1c2VNb2R1bGUobW9kdWxlOiBJRncyNE1vZHVsZSk6IHRoaXMge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNhbGxlZCBVc2VNb2R1bGUgd2l0aCBtb2R1bGU6IFwiLCB7IG1vZHVsZU5hbWU6IG1vZHVsZS5nZXROYW1lKCkgfSk7XG5cbiAgICAgICAgaWYgKHRoaXMubW9kdWxlcy5oYXMobW9kdWxlLmdldE5hbWUoKSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kdWxlIHdpdGggbmFtZSAke21vZHVsZS5nZXROYW1lKCl9IGlzIGFscmVhZHkgcmVnaXN0ZXJlZC5gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubW9kdWxlcy5zZXQobW9kdWxlLmdldE5hbWUoKSwgbW9kdWxlKTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsgY29uc3RydWN0TmFtZSwgY29uc3RydWN0IF0gb2YgbW9kdWxlLmdldENvbnN0cnVjdHMoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlVzZU1vZHVsZTogUmVnaXN0ZXJpbmcgY29uc3RydWN0OiBcIiwgY29uc3RydWN0TmFtZSwgbW9kdWxlLmdldERlcGVuZGVuY2llcygpLCBjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgIGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMgPSBtb2R1bGUuZ2V0RGVwZW5kZW5jaWVzKCk7XG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ29uc3RydWN0KGNvbnN0cnVjdCwgY29uc3RydWN0TmFtZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBydW4oKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJSdW5uaW5nIGZ3MjQgaW5mcmFzdHJ1Y3R1cmUuLi5cIik7XG5cbiAgICAgICAgLy8gQ3JlYXRlIGRlZmF1bHQgZncyNCBydW50aW1lIGxheWVyIChPTkxZIHJ1bnRpbWUgY29kZSwgbm90IGluZnJhc3RydWN0dXJlKVxuICAgICAgICAvLyBUaGlzIGxheWVyIGlzIGF1dG9tYXRpY2FsbHkgYXR0YWNoZWQgdG8gYWxsIExhbWJkYSBmdW5jdGlvbnNcbiAgICAgICAgLy8gSXQncyBOT1QgYW4gZW50cnkgcGFja2FnZSAtIGl0J3MganVzdCBhdmFpbGFibGUgZm9yIGltcG9ydHNcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkJ1aWxkaW5nIGZ3MjQgcnVudGltZSBsYXllci4uLlwiKTtcbiAgICAgICAgY29uc3QgZncyNExheWVyID0gbmV3IExheWVyQ29uc3RydWN0KFsge1xuICAgICAgICAgICAgbW9kZTogJ0JVSUxEX0FORF9QQUNLQUdFJyxcbiAgICAgICAgICAgIC8vIEJ1bmRsZSB0aGUgZncyNCBydW50aW1lIHNvdXJjZSAoaGFzIGltcG9ydHMsIG5lZWRzIGJ1bmRsaW5nIHdpdGggZXNidWlsZClcbiAgICAgICAgICAgIHNvdXJjZVBhdGg6ICcuL25vZGVfbW9kdWxlcy9AdGVuMjRncm91cC9mdzI0L2Rpc3QvcGFja2FnZS9sYXllci9mdzI0LmpzJyxcbiAgICAgICAgICAgIHBhY2thZ2VQYXRoOiAnQHRlbjI0Z3JvdXAvZncyNCcsXG4gICAgICAgICAgICBwcmlvcml0eTogMCxcbiAgICAgICAgICAgIC8vIE91dHB1dCB0byBhcHBsaWNhdGlvbidzIGRpc3QvbGF5ZXJzIGRpcmVjdG9yeSwgbm90IGZyYW1ld29yaydzIGRpcmVjdG9yeVxuICAgICAgICAgICAgZGlzdERpcmVjdG9yeTogcGF0aEpvaW4ocHJvY2Vzcy5jd2QoKSwgJ2Rpc3QvbGF5ZXJzJyksXG4gICAgICAgICAgICBidWlsZE9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICAgICAgICAgICAgZXh0ZXJuYWw6IFsgJ0Bhd3Mtc2RrJywgJ0BzbWl0aHknIF0gLy8gQVdTIFNESyBpcyBOT1QgcHJvdmlkZWQgYnkgTGFtYmRhIHJ1bnRpbWVcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBpc0VudHJ5UGFja2FnZTogZmFsc2UsXG4gICAgICAgIH0gXSk7XG4gICAgICAgIGF3YWl0IGZ3MjRMYXllci5jb25zdHJ1Y3QoKTtcblxuICAgICAgICAvLyAqKiogb3JkZXIgaXMgaW1wb3J0YW50IGhlcmUsIG1vZHVsZXMgbmVlZCB0byBiZSBwcm9jZXNzZWQgZmlyc3QsIGJlZm9yZSBjb25zdHJ1Y3RzICoqKlxuICAgICAgICB0aGlzLnByb2Nlc3NNb2R1bGVzKCk7XG5cbiAgICAgICAgY29uc3QgZGlzYWJsZVVJQ29uZmlnR2VuID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldENvbmZpZygpLmRpc2FibGVVSUNvbmZpZ0dlbjtcblxuICAgICAgICBpZiAoIWRpc2FibGVVSUNvbmZpZ0dlbikge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy51aUNvbmZpZ0dlbi5ydW4oKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNvbmZpZ3VyZSBhIGJ1aWxkIGNvbW1hbmQgbGlrZSBpbiBwYWNrYWdlLmpzb24gdG8gb25seSBnZW5lcmF0ZSB0aGUgdWkgY29uZmlnXG4gICAgICAgIC8vIFwidWk6Z2VuXCI6IFwiVUlfR0VOX09OTFk9dHJ1ZSBlbnYtY21kIC1mIC5lbnYubG9jYWwgdHMtbm9kZSBzcmMvaW5kZXgudHNcIlxuICAgICAgICAvLyB0aGlzIGlzIHVzZWZ1bCBmb3IgZ2VuZXJhdGluZyB0aGUgdWkgY29uZmlnIGR1cmluZyBkZXZlbG9wbWVudFxuICAgICAgICBpZiAocHJvY2Vzcy5lbnYuVUlfR0VOX09OTFkgPT09ICd0cnVlJykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnVUkgY29uZmlnIGdlbmVyYXRpb24gY29tcGxldGUuIEV4aXRpbmcuJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuXG4gICAgICAgIC8vIEJ1aWxkIHVzZXItZGVmaW5lZCBsYXllcnMgQkVGT1JFIGFueSBvdGhlciBjb25zdHJ1Y3RzXG4gICAgICAgIC8vIFRoaXMgZW5zdXJlcyBsYXllcnMgYW5kIGVudHJ5IHBhY2thZ2VzIGFyZSBhdmFpbGFibGUgZm9yIGFueSBsYW1iZGFzIGNyZWF0ZWQgYnkgYW55IGNvbnN0cnVjdFxuICAgICAgICBhd2FpdCB0aGlzLmJ1aWxkVXNlckxheWVycygpO1xuXG4gICAgICAgIGNvbnN0IHRvdGFsQ29uc3RydWN0cyA9IHRoaXMuY29uc3RydWN0cy5zaXplO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfWApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDwn5qAIEJ1aWxkaW5nICR7dG90YWxDb25zdHJ1Y3RzfSBjb25zdHJ1Y3QocykuLi5gKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgJHsnPScucmVwZWF0KDYwKX1cXG5gKTtcblxuICAgICAgICBhd2FpdCB0aGlzLmNvbnN0cnVjdEFsbFJlc291cmNlcygpXG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgJHsnPScucmVwZWF0KDYwKX1gKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg4pyFIEFsbCBjb25zdHJ1Y3RzIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHlgKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgJHsnPScucmVwZWF0KDYwKX1cXG5gKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBCdWlsZCB1c2VyLWRlZmluZWQgbGF5ZXIgY29uc3RydWN0cyBiZWZvcmUgb3RoZXIgY29uc3RydWN0cy5cbiAgICAgKiBUaGlzIGVuc3VyZXMgZW50cnkgcGFja2FnZXMgYXJlIHJlZ2lzdGVyZWQgYmVmb3JlIGFueSBsYW1iZGFzIGFyZSBjcmVhdGVkLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgYnVpbGRVc2VyTGF5ZXJzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCBsYXllckNvbnN0cnVjdHMgPSBBcnJheS5mcm9tKHRoaXMuY29uc3RydWN0cy5lbnRyaWVzKCkpXG4gICAgICAgICAgICAuZmlsdGVyKChbIF8sIGNvbnN0cnVjdCBdKSA9PiBjb25zdHJ1Y3QubmFtZSA9PT0gJ0xheWVyQ29uc3RydWN0JylcbiAgICAgICAgICAgIC5tYXAoKFsgbmFtZSBdKSA9PiBuYW1lKTtcblxuICAgICAgICBpZiAobGF5ZXJDb25zdHJ1Y3RzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQnVpbGRpbmcgJHtsYXllckNvbnN0cnVjdHMubGVuZ3RofSB1c2VyIGxheWVyKHMpIGZpcnN0Li4uYCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBjb25zdHJ1Y3ROYW1lIG9mIGxheWVyQ29uc3RydWN0cykge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb25zdHJ1Y3RSZXNvdXJjZXMoY29uc3RydWN0TmFtZSk7XG4gICAgICAgIH1cbiAgICB9XG5cblxuICAgIHByaXZhdGUgcmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0OiBGVzI0Q29uc3RydWN0LCBuYW1lPzogc3RyaW5nKSB7XG4gICAgICAgIGxldCBjb25zdHJ1Y3ROYW1lID0gbmFtZSB8fCBjb25zdHJ1Y3QubmFtZTtcbiAgICAgICAgaWYgKHRoaXMuY29uc3RydWN0cy5oYXMoY29uc3RydWN0TmFtZSkpIHtcbiAgICAgICAgICAgIC8vIGhhbmRsZSBtdWx0aXBsZSBjb25zdHJ1Y3RzIG9mIHNhbWUgdHlwZVxuICAgICAgICAgICAgY29uc3QgbmV3Q29uc3RydWN0TmFtZSA9IGNvbnN0cnVjdE5hbWUuY29uY2F0KCctJywgcmFuZG9tVVVJRCgpKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbnN0cnVjdCB3aXRoIG5hbWUgJHtjb25zdHJ1Y3ROYW1lfSBpcyBhbHJlYWR5IHJlZ2lzdGVyZWQsIHJlbmFtaW5nIHRvICR7bmV3Q29uc3RydWN0TmFtZX1gKTtcbiAgICAgICAgICAgIGNvbnN0cnVjdE5hbWUgPSBuZXdDb25zdHJ1Y3ROYW1lO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY29uc3RydWN0cy5zZXQoY29uc3RydWN0TmFtZSwgY29uc3RydWN0KTtcbiAgICAgICAgdGhpcy5mdzI0LmFkZENvbnN0cnVjdChjb25zdHJ1Y3QpO1xuICAgIH1cblxuICAgIHByaXZhdGUgcHJvY2Vzc01vZHVsZXMoKSB7XG4gICAgICAgIGZvciAoY29uc3QgWyBtb2R1bGVOYW1lLCBtb2R1bGUgXSBvZiB0aGlzLm1vZHVsZXMpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5hZGRNb2R1bGUobW9kdWxlTmFtZSwgbW9kdWxlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgY29uc3RydWN0QWxsUmVzb3VyY2VzKCkge1xuICAgICAgICBjb25zdCBhbGxDb25zdHJ1Y3RzID0gQXJyYXkuZnJvbSh0aGlzLmNvbnN0cnVjdHMua2V5cygpKS5tYXAoY29uc3RydWN0TmFtZSA9PiB0aGlzLmNvbnN0cnVjdFJlc291cmNlcyhjb25zdHJ1Y3ROYW1lKSk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChhbGxDb25zdHJ1Y3RzKTtcbiAgICB9XG5cbiAgICBhc3luYyBjb25zdHJ1Y3RSZXNvdXJjZXMoY29uc3RydWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIENoZWNrIGlmIGFscmVhZHkgcHJvY2Vzc2VkIG9yIGluIHByb2dyZXNzIC0gcHJldmVudCBkdXBsaWNhdGUgYnVpbGRzXG4gICAgICAgIGlmICh0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGNvbnN0cnVjdE5hbWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmdldChjb25zdHJ1Y3ROYW1lKSE7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb25zdHJ1Y3QgPSB0aGlzLmNvbnN0cnVjdHMuZ2V0KGNvbnN0cnVjdE5hbWUpO1xuICAgICAgICBpZiAoIWNvbnN0cnVjdCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb25zdHJ1Y3QgJHtjb25zdHJ1Y3ROYW1lfSBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHdoaWxlICh0aGlzLnJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5ID49IHRoaXMucmVzb3VyY2VDb25zdHJ1Y3RNYXhDb25jdXJyZW5jeSkge1xuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDEwMCkpOyAvLyBUaHJvdHRsZSBpZiBjb25jdXJyZW5jeSBsaW1pdCBpcyByZWFjaGVkXG4gICAgICAgIH1cblxuICAgICAgICAvLyBPbmx5IGxvZyBpZiB0aGVyZSBhcmUgYWN0dWFsIGRlcGVuZGVuY2llc1xuICAgICAgICBpZiAoY29uc3RydWN0LmRlcGVuZGVuY2llcyAmJiBjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGDij7MgJHtjb25zdHJ1Y3ROYW1lfTogV2FpdGluZyBmb3IgZGVwZW5kZW5jaWVzOiAke2NvbnN0cnVjdC5kZXBlbmRlbmNpZXMuam9pbignLCAnKX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFdhaXQgZm9yIGRlcGVuZGVuY2llcyB0byByZXNvbHZlXG4gICAgICAgIGF3YWl0IHRoaXMud2FpdEZvckRlcGVuZGVuY2llcyhjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzLCBjb25zdHJ1Y3ROYW1lKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDwn5SoIEJ1aWxkaW5nICR7Y29uc3RydWN0TmFtZX0uLi5gKTtcblxuICAgICAgICB0aGlzLnJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5Kys7XG4gICAgICAgIGNvbnN0IHRpbWVyID0gVGltZXIuc3RhcnQoKTtcbiAgICAgICAgY29uc3QgY29uc3RydWN0Q29tcGxldGlvblByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCBjb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg4pyFICR7Y29uc3RydWN0TmFtZX0gY29tcGxldGVkIGluICR7dGltZXIuZWxhcHNlZFNlY29uZHMoKX1gKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYOKdjCAke2NvbnN0cnVjdE5hbWV9IGZhaWxlZDpgLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7IC8vIFJlLXRocm93IHRvIGVuc3VyZSBkZXBsb3ltZW50IGZhaWxzXG4gICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgIHRoaXMucmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3ktLTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkoKTtcblxuICAgICAgICB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuc2V0KGNvbnN0cnVjdE5hbWUsIGNvbnN0cnVjdENvbXBsZXRpb25Qcm9taXNlKTtcbiAgICAgICAgcmV0dXJuIGNvbnN0cnVjdENvbXBsZXRpb25Qcm9taXNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgd2FpdEZvckRlcGVuZGVuY2llcyhkZXBlbmRlbmNpZXM6IHN0cmluZ1tdLCBjb25zdHJ1Y3ROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKCFkZXBlbmRlbmNpZXMgfHwgZGVwZW5kZW5jaWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBkZXBlbmRlbmNpZXMubWFwKGRlcGVuZGVuY3kgPT4ge1xuICAgICAgICAgICAgLy8gaWYgZGVwZW5kZW5jeSBjb25zdHJ1Y3QgZG9lcyBub3QgZXhpc3RzIGluIHRoZSBjb25zdHJ1Y3QgbGlzdCwgbWFyayBpdCBhcyBwcm9jZXNzZWRcbiAgICAgICAgICAgIGlmICghdGhpcy5jb25zdHJ1Y3RzLmhhcyhkZXBlbmRlbmN5KSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGAke2NvbnN0cnVjdE5hbWV9OiBEZXBlbmRlbmN5ICR7ZGVwZW5kZW5jeX0gbm90IHJlZ2lzdGVyZWQgKG9wdGlvbmFsIGRlcGVuZGVuY3kpYCk7XG4gICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLnNldChkZXBlbmRlbmN5LCBQcm9taXNlLnJlc29sdmUoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIXRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICAvLyBJZiBkZXBlbmRlbmN5IG5vdCBzY2hlZHVsZWQgeWV0LCBsaXN0ZW4gZm9yIGl0cyBhZGRpdGlvblxuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGVhckludGVydmFsKGludGVydmFsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuZ2V0KGRlcGVuZGVuY3kpIS50aGVuKHJlc29sdmUsIHJlamVjdCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sIDEwMCk7IC8vIENoZWNrIGV2ZXJ5IDEwMG1zXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmdldChkZXBlbmRlbmN5KSE7XG4gICAgICAgIH0pO1xuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChwcm9taXNlcyk7XG4gICAgfVxuXG59XG4iXX0=