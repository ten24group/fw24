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
const aws_dynamodb_1 = require("aws-cdk-lib/aws-dynamodb");
const fw24_1 = require("./core/fw24");
const entity_ui_config_gen_1 = require("./ui-config-gen/entity-ui-config.gen");
const logging_1 = require("./logging");
const constructs_1 = require("./constructs");
const utils_1 = require("./utils");
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
const coordinator_1 = require("./testing/simulator/coordinator");
const hmr_watcher_1 = require("./testing/simulator/hmr-watcher");
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
    observabilityConfig;
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
        // Store observability config for processing in run()
        if (config.observability) {
            this.observabilityConfig = config.observability;
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
        // Build user-defined layers BEFORE observability setup
        // This ensures entry packages are registered for any lambdas created by observability DynamoDB
        await this.buildUserLayers();
        // Setup observability infrastructure AFTER user layers are built
        // This ensures any lambdas created by observability have access to entry packages
        if (this.observabilityConfig) {
            await this.setupObservability(this.observabilityConfig);
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
    /**
     * Setup observability infrastructure.
     * - `true` = DynamoDB with defaults
     * - `{ dynamodb: {...} }` = DynamoDB table
     * - `{ cloudwatch: {...} }` = Custom CloudWatch log group (no DynamoDB)
     * - `{ dynamodb: {...}, cloudwatch: {...} }` = Both
     */
    async setupObservability(config) {
        // true = shorthand for { dynamodb: {} }
        const cfg = config === true ? { dynamodb: {} } : config;
        // Setup CloudWatch if configured
        if (cfg.cloudwatch?.enabled !== false && cfg.cloudwatch) {
            await this.setupObservabilityCloudWatch(cfg);
        }
        // Setup DynamoDB if configured
        if (cfg.dynamodb?.enabled !== false && cfg.dynamodb) {
            await this.setupObservabilityDynamoDB(cfg);
        }
        // Log if neither backend is configured
        if (!cfg.dynamodb && !cfg.cloudwatch) {
            this.logger.info('⚠️ Observability enabled but no backends configured');
        }
    }
    /**
     * Setup DynamoDB infrastructure for observability.
     */
    async setupObservabilityDynamoDB(cfg) {
        const db = cfg.dynamodb;
        // Table name: use db.name if provided, otherwise 'observabilitylogs'
        // No appName prefix - keeps tableKey simple and convention-based
        const tableName = db.name ?? 'observabilitylogs';
        // Check if stream needed
        const hasSearchIndexing = db.searchIndexing?.some((s) => s.enabled);
        const hasStreamConfig = db.stream?.enabled;
        const needsStream = hasSearchIndexing || hasStreamConfig;
        // Default table props (6 GSIs)
        const defaultProps = {
            partitionKey: { name: 'pk', type: aws_dynamodb_1.AttributeType.STRING },
            sortKey: { name: 'sk', type: aws_dynamodb_1.AttributeType.STRING },
            timeToLiveAttribute: 'ttl',
            dynamoStream: needsStream ? aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES : undefined,
            globalSecondaryIndexes: [
                { indexName: 'gsi1', partitionKey: { name: 'gsi1pk', type: aws_dynamodb_1.AttributeType.STRING }, sortKey: { name: 'gsi1sk', type: aws_dynamodb_1.AttributeType.STRING } },
                { indexName: 'gsi2', partitionKey: { name: 'gsi2pk', type: aws_dynamodb_1.AttributeType.STRING }, sortKey: { name: 'gsi2sk', type: aws_dynamodb_1.AttributeType.STRING } },
                { indexName: 'gsi3', partitionKey: { name: 'gsi3pk', type: aws_dynamodb_1.AttributeType.STRING }, sortKey: { name: 'gsi3sk', type: aws_dynamodb_1.AttributeType.STRING } },
                { indexName: 'gsi4', partitionKey: { name: 'gsi4pk', type: aws_dynamodb_1.AttributeType.STRING }, sortKey: { name: 'gsi4sk', type: aws_dynamodb_1.AttributeType.STRING } },
                { indexName: 'gsi5', partitionKey: { name: 'gsi5pk', type: aws_dynamodb_1.AttributeType.STRING }, sortKey: { name: 'gsi5sk', type: aws_dynamodb_1.AttributeType.STRING } },
                { indexName: 'gsi6', partitionKey: { name: 'gsi6pk', type: aws_dynamodb_1.AttributeType.STRING }, sortKey: { name: 'gsi6sk', type: aws_dynamodb_1.AttributeType.STRING } },
                { indexName: 'gsi7', partitionKey: { name: 'gsi7pk', type: aws_dynamodb_1.AttributeType.STRING }, sortKey: { name: 'gsi7sk', type: aws_dynamodb_1.AttributeType.STRING } },
                { indexName: 'gsi8', partitionKey: { name: 'gsi8pk', type: aws_dynamodb_1.AttributeType.STRING }, sortKey: { name: 'gsi8sk', type: aws_dynamodb_1.AttributeType.STRING } },
                { indexName: 'gsi9', partitionKey: { name: 'gsi9pk', type: aws_dynamodb_1.AttributeType.STRING }, sortKey: { name: 'gsi9sk', type: aws_dynamodb_1.AttributeType.STRING } },
            ],
            ...db.props,
        };
        const dynamoConstruct = new constructs_1.DynamoDBConstruct({
            stackName: cfg.stackName ?? 'persistent',
            parentStackName: cfg.parentStackName,
            table: {
                name: tableName,
                props: defaultProps,
                stream: db.stream,
                searchIndexing: db.searchIndexing,
            },
        });
        dynamoConstruct.name = 'observability-dynamodb';
        await dynamoConstruct.construct();
        // Add global resource access - LambdaFunction sets env var automatically
        this.fw24.addGlobalResourceAccess({
            tables: [{ name: tableName, access: ['readwrite'] }],
        });
        const features = [];
        if (hasSearchIndexing)
            features.push('search');
        if (hasStreamConfig)
            features.push('stream');
        this.logger.info(`✅ Observability: ${tableName}${features.length ? ' (' + features.join(', ') + ')' : ''}`);
    }
    /**
     * Setup CloudWatch infrastructure for observability.
     */
    async setupObservabilityCloudWatch(cfg) {
        const cw = cfg.cloudwatch;
        const appName = this.fw24.getConfig().name || 'app';
        const logGroupName = cw.logGroupName ?? `/observability/${appName}`;
        // TODO: Create custom log group when needed
        // For now, just set env var so runtime can use it
        this.fw24.setGlobalEnvironmentVariable('OBSERVABILITY_LOG_GROUP', logGroupName);
        if (cw.retentionDays) {
            this.fw24.setGlobalEnvironmentVariable('OBSERVABILITY_LOG_RETENTION_DAYS', String(cw.retentionDays));
        }
        this.logger.info(`✅ Observability CloudWatch: ${logGroupName}`);
    }
    /**
     * Start the local simulator for development.
     */
    async simulate(config = {}) {
        // Prevent recursive simulate calls if we are currently synthesizing a blueprint
        if (process.env.FW24_SIMULATOR_SYNCING === 'true' || process.env.CDK_OUTDIR || process.env.CDK_CONTEXT_JSON) {
            this.logger.info("Inside CDK sync process, skipping simulator startup.");
            return;
        }
        this.logger.info("Starting High-Fidelity Simulator (fw24 dev)...");
        const coordinator = new coordinator_1.SimulatorCoordinator(config);
        // Pass global environment variables to simulator
        const globalEnv = {};
        this.fw24.getGlobalEnvironmentVariables().forEach(key => {
            globalEnv[key] = this.fw24.getEnvironmentVariable(key);
        });
        // Also include standard environment variables from config
        if (this.fw24.getConfig().environmentVariables) {
            Object.assign(globalEnv, this.fw24.getConfig().environmentVariables);
        }
        coordinator.setGlobalEnv(globalEnv);
        const sync = async () => {
            // Prevent recursive sync calls if simulate() is called during synth
            if (process.env.FW24_SIMULATOR_SYNCING === 'true') {
                return;
            }
            this.logger.info("Syncing with CDK blueprint...");
            try {
                // 1. Run CDK Synth
                const { spawnSync } = require('node:child_process');
                this.logger.info("Running 'cdk synth' to generate blueprint...");
                // Unset SIMULATE and set sentinel to avoid recursion
                const env = {
                    ...process.env,
                    SIMULATE: 'false',
                    FW24_SIMULATOR_SYNCING: 'true'
                };
                const result = spawnSync('npx', ['cdk', 'synth'], {
                    stdio: 'inherit',
                    shell: true,
                    env
                });
                if (result.status !== 0) {
                    this.logger.error("❌ CDK Synth failed. Simulator cannot start/sync without a valid blueprint.");
                    this.logger.error("Please fix the errors in your CDK/Infrastructure code and the simulator will retry on the next save.");
                    return;
                }
                // 2. Sync Coordinator with CDK blueprint
                await coordinator.syncWithCDK();
                this.logger.info("✅ Simulator synced with latest CDK blueprint.");
            }
            catch (error) {
                this.logger.error("❌ Error during CDK synchronization:", error.message);
                this.logger.debug(error.stack);
            }
        };
        await sync();
        // 3. Start Simulator
        await coordinator.start();
        // 4. Setup HMR
        if (config.hotReload !== false) {
            const watcher = new hmr_watcher_1.HMRWatcher('./src', async () => {
                this.logger.info("Change detected, re-synthesizing...");
                await sync();
            });
            watcher.start();
        }
        this.logger.info("Simulator is ready!");
        return coordinator;
    }
}
exports.Application = Application;
__decorate([
    (0, logging_1.LogDuration)()
], Application.prototype, "run", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsNkNBQXlDO0FBQ3pDLDJEQUF5RTtBQUN6RSxzQ0FBbUM7QUFJbkMsK0VBQXlFO0FBQ3pFLHVDQUErRDtBQUMvRCw2Q0FBaUU7QUFDakUsbUNBQWdDO0FBQ2hDLDZDQUF5QztBQUN6Qyx5Q0FBc0Q7QUFFdEQsaUVBQXVFO0FBRXZFLGlFQUE2RDtBQUU3RCxNQUFhLFdBQVc7SUFDWCxNQUFNLENBQVU7SUFDekIsU0FBUyxDQUFTO0lBRUYsSUFBSSxDQUFPO0lBQ1gsV0FBVyxDQUFvQjtJQUM5QixVQUFVLENBQTZCO0lBQ3ZDLE9BQU8sQ0FBMkI7SUFDbEMsbUJBQW1CLEdBQStCLElBQUksR0FBRyxFQUFFLENBQUM7SUFDNUQsK0JBQStCLEdBQVcsRUFBRSxDQUFDO0lBQ3RELG1DQUFtQyxHQUFHLENBQUMsQ0FBQztJQUMvQixtQkFBbUIsQ0FBd0I7SUFFNUQsWUFBWSxTQUE2QixFQUFFO1FBQ3ZDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLENBQUUsV0FBVyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxXQUFXLENBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUU1RixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO1FBRXhELElBQUksQ0FBQyxJQUFJLEdBQUcsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQy9CLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSx3Q0FBaUIsRUFBRSxDQUFDO1FBQzNDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRTVCLElBQUksTUFBTSxDQUFDLG9CQUFvQixFQUFFLENBQUM7WUFDOUIsTUFBTSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFFLEdBQUcsRUFBRSxLQUFLLENBQUUsRUFBRSxFQUFFO2dCQUNuRSxJQUFJLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUNqRCxDQUFDLENBQUMsQ0FBQTtRQUNOLENBQUM7UUFFRCxJQUFJLE1BQU0sQ0FBQywwQkFBMEIsRUFBRSxDQUFDO1lBQ3BDLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLDBCQUEwQixDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBRSxHQUFHLEVBQUUsS0FBSyxDQUFFLEVBQUUsRUFBRTtnQkFDekUsSUFBSSxDQUFDLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDdkQsQ0FBQyxDQUFDLENBQUE7UUFDTixDQUFDO1FBRUQsb0NBQW9DO1FBQ3BDLElBQUksTUFBTSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3hCLE1BQU0sQ0FBQyxjQUFjLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFO2dCQUNuQyxJQUFJLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUN0QyxDQUFDLENBQUMsQ0FBQztRQUNQLENBQUM7UUFFRCwyQ0FBMkM7UUFDM0MsSUFBSSxNQUFNLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztZQUM5QixJQUFJLENBQUMsSUFBSSxDQUFDLHVCQUF1QixDQUFDLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO1FBQ25FLENBQUM7UUFFRCxpR0FBaUc7UUFDakcsK0VBQStFO1FBQy9FLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDakQsSUFBSSxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxXQUFXLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxTQUFTLElBQUksTUFBTSxDQUFDLENBQUM7UUFDbkYsQ0FBQztRQUVELHFEQUFxRDtRQUNyRCxJQUFJLE1BQU0sQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUN2QixJQUFJLENBQUMsbUJBQW1CLEdBQUcsTUFBTSxDQUFDLGFBQWEsQ0FBQztRQUNwRCxDQUFDO1FBRUQsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUV6Qiw0QkFBNEI7UUFDNUIsTUFBTSxHQUFHLEdBQUcsSUFBSSxpQkFBRyxFQUFFLENBQUM7UUFDdEIsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7SUFFMUIsQ0FBQztJQUVNLEdBQUcsQ0FBQyxTQUF3QjtRQUMvQixJQUFJLENBQUMsaUJBQWlCLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDbEMsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVNLFNBQVMsQ0FBQyxNQUFtQjtRQUNoQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxnQ0FBZ0MsRUFBRSxFQUFFLFVBQVUsRUFBRSxNQUFNLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRXRGLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUNyQyxNQUFNLElBQUksS0FBSyxDQUFDLG9CQUFvQixNQUFNLENBQUMsT0FBTyxFQUFFLHlCQUF5QixDQUFDLENBQUM7UUFDbkYsQ0FBQztRQUVELElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUUzQyxLQUFLLE1BQU0sQ0FBRSxhQUFhLEVBQUUsU0FBUyxDQUFFLElBQUksTUFBTSxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUM7WUFDaEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsb0NBQW9DLEVBQUUsYUFBYSxFQUFFLE1BQU0sQ0FBQyxlQUFlLEVBQUUsRUFBRSxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDeEgsU0FBUyxDQUFDLFlBQVksR0FBRyxNQUFNLENBQUMsZUFBZSxFQUFFLENBQUM7WUFDbEQsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFNBQVMsRUFBRSxhQUFhLENBQUMsQ0FBQztRQUNyRCxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUdZLEFBQU4sS0FBSyxDQUFDLEdBQUc7UUFDWixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDO1FBRW5ELHlGQUF5RjtRQUN6RixJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7UUFFdEIsTUFBTSxrQkFBa0IsR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsU0FBUyxFQUFFLENBQUMsa0JBQWtCLENBQUM7UUFFN0UsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDdEIsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ2pDLENBQUM7UUFFRCxnRkFBZ0Y7UUFDaEYsMEVBQTBFO1FBQzFFLGlFQUFpRTtRQUNqRSxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxLQUFLLE1BQU0sRUFBRSxDQUFDO1lBQ3JDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHlDQUF5QyxDQUFDLENBQUM7WUFDNUQsT0FBTztRQUNYLENBQUM7UUFFRCw0RUFBNEU7UUFDNUUsK0RBQStEO1FBQy9ELDhEQUE4RDtRQUM5RCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDO1FBQ25ELE1BQU0sU0FBUyxHQUFHLElBQUksMkJBQWMsQ0FBQyxDQUFFO2dCQUNuQyxJQUFJLEVBQUUsbUJBQW1CO2dCQUN6Qiw0RUFBNEU7Z0JBQzVFLFVBQVUsRUFBRSw0REFBNEQ7Z0JBQ3hFLFdBQVcsRUFBRSxrQkFBa0I7Z0JBQy9CLFFBQVEsRUFBRSxDQUFDO2dCQUNYLDJFQUEyRTtnQkFDM0UsYUFBYSxFQUFFLElBQUEsZ0JBQVEsRUFBQyxPQUFPLENBQUMsR0FBRyxFQUFFLEVBQUUsYUFBYSxDQUFDO2dCQUNyRCxZQUFZLEVBQUU7b0JBQ1YsU0FBUyxFQUFFLElBQUk7b0JBQ2YsUUFBUSxFQUFFLENBQUUsVUFBVSxFQUFFLFNBQVMsQ0FBRSxDQUFDLDRDQUE0QztpQkFDbkY7Z0JBQ0QsY0FBYyxFQUFFLEtBQUs7YUFDeEIsQ0FBRSxDQUFDLENBQUM7UUFDTCxNQUFNLFNBQVMsQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUU1Qix1REFBdUQ7UUFDdkQsK0ZBQStGO1FBQy9GLE1BQU0sSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1FBRTdCLGlFQUFpRTtRQUNqRSxrRkFBa0Y7UUFDbEYsSUFBSSxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztZQUMzQixNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FBQztRQUM1RCxDQUFDO1FBRUQsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUM7UUFDN0MsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUN0QyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxlQUFlLGVBQWUsa0JBQWtCLENBQUMsQ0FBQztRQUNuRSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRXhDLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFFbEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUN0QyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyx5Q0FBeUMsQ0FBQyxDQUFDO1FBQzVELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDNUMsQ0FBQztJQUVEOzs7T0FHRztJQUNLLEtBQUssQ0FBQyxlQUFlO1FBQ3pCLE1BQU0sZUFBZSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsQ0FBQzthQUN4RCxNQUFNLENBQUMsQ0FBQyxDQUFFLENBQUMsRUFBRSxTQUFTLENBQUUsRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLElBQUksS0FBSyxnQkFBZ0IsQ0FBQzthQUNqRSxHQUFHLENBQUMsQ0FBQyxDQUFFLElBQUksQ0FBRSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUU3QixJQUFJLGVBQWUsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDL0IsT0FBTztRQUNYLENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxZQUFZLGVBQWUsQ0FBQyxNQUFNLHlCQUF5QixDQUFDLENBQUM7UUFFOUUsS0FBSyxNQUFNLGFBQWEsSUFBSSxlQUFlLEVBQUUsQ0FBQztZQUMxQyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUNqRCxDQUFDO0lBQ0wsQ0FBQztJQUdPLGlCQUFpQixDQUFDLFNBQXdCLEVBQUUsSUFBYTtRQUM3RCxJQUFJLGFBQWEsR0FBRyxJQUFJLElBQUksU0FBUyxDQUFDLElBQUksQ0FBQztRQUMzQyxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7WUFDckMsMENBQTBDO1lBQzFDLE1BQU0sZ0JBQWdCLEdBQUcsYUFBYSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUUsSUFBQSx3QkFBVSxHQUFFLENBQUMsQ0FBQztZQUNqRSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyx1QkFBdUIsYUFBYSx1Q0FBdUMsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDO1lBQ2hILGFBQWEsR0FBRyxnQkFBZ0IsQ0FBQztRQUNyQyxDQUFDO1FBQ0QsSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQzlDLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQ3RDLENBQUM7SUFFTyxjQUFjO1FBQ2xCLEtBQUssTUFBTSxDQUFFLFVBQVUsRUFBRSxNQUFNLENBQUUsSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDaEQsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQzVDLENBQUM7SUFDTCxDQUFDO0lBRU8scUJBQXFCO1FBQ3pCLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDO1FBQ3RILE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUN0QyxDQUFDO0lBRUQsS0FBSyxDQUFDLGtCQUFrQixDQUFDLGFBQXFCO1FBQzFDLHVFQUF1RTtRQUN2RSxJQUFJLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUM5QyxPQUFPLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFFLENBQUM7UUFDeEQsQ0FBQztRQUVELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQ3JELElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNiLE1BQU0sSUFBSSxLQUFLLENBQUMsYUFBYSxhQUFhLFlBQVksQ0FBQyxDQUFDO1FBQzVELENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyxtQ0FBbUMsSUFBSSxJQUFJLENBQUMsK0JBQStCLEVBQUUsQ0FBQztZQUN0RixNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsMkNBQTJDO1FBQ3ZHLENBQUM7UUFFRCw0Q0FBNEM7UUFDNUMsSUFBSSxTQUFTLENBQUMsWUFBWSxJQUFJLFNBQVMsQ0FBQyxZQUFZLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzlELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssYUFBYSwrQkFBK0IsU0FBUyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQzVHLENBQUM7UUFFRCxtQ0FBbUM7UUFDbkMsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsU0FBUyxDQUFDLFlBQVksRUFBRSxhQUFhLENBQUMsQ0FBQztRQUV0RSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxlQUFlLGFBQWEsS0FBSyxDQUFDLENBQUM7UUFFcEQsSUFBSSxDQUFDLG1DQUFtQyxFQUFFLENBQUM7UUFDM0MsTUFBTSxLQUFLLEdBQUcsYUFBSyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQzVCLE1BQU0sMEJBQTBCLEdBQUcsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUMzQyxJQUFJLENBQUM7Z0JBQ0QsTUFBTSxTQUFTLENBQUMsU0FBUyxFQUFFLENBQUM7Z0JBQzVCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssYUFBYSxpQkFBaUIsS0FBSyxDQUFDLGNBQWMsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUNsRixDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDYixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLGFBQWEsVUFBVSxFQUFFLEtBQUssQ0FBQyxDQUFDO2dCQUN2RCxNQUFNLEtBQUssQ0FBQyxDQUFDLHNDQUFzQztZQUN2RCxDQUFDO29CQUFTLENBQUM7Z0JBQ1AsSUFBSSxDQUFDLG1DQUFtQyxFQUFFLENBQUM7WUFDL0MsQ0FBQztRQUNMLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFFTCxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSwwQkFBMEIsQ0FBQyxDQUFDO1FBQ3hFLE9BQU8sMEJBQTBCLENBQUM7SUFDdEMsQ0FBQztJQUVPLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxZQUFzQixFQUFFLGFBQXFCO1FBQzNFLElBQUksQ0FBQyxZQUFZLElBQUksWUFBWSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUM3QyxPQUFPO1FBQ1gsQ0FBQztRQUVELE1BQU0sUUFBUSxHQUFHLFlBQVksQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLEVBQUU7WUFDM0Msc0ZBQXNGO1lBQ3RGLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO2dCQUNuQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLGFBQWEsZ0JBQWdCLFVBQVUsdUNBQXVDLENBQUMsQ0FBQztnQkFDckcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUM7WUFDaEUsQ0FBQztZQUNELElBQUksQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7Z0JBQzVDLDJEQUEyRDtnQkFDM0QsT0FBTyxJQUFJLE9BQU8sQ0FBTyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtvQkFDekMsTUFBTSxRQUFRLEdBQUcsV0FBVyxDQUFDLEdBQUcsRUFBRTt3QkFDOUIsSUFBSSxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7NEJBQzNDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQzs0QkFDeEIsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUUsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO3dCQUNwRSxDQUFDO29CQUNMLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLG9CQUFvQjtnQkFDakMsQ0FBQyxDQUFDLENBQUM7WUFDUCxDQUFDO1lBQ0QsT0FBTyxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBRSxDQUFDO1FBQ3JELENBQUMsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ2hDLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSyxLQUFLLENBQUMsa0JBQWtCLENBQUMsTUFBd0M7UUFDckUsd0NBQXdDO1FBQ3hDLE1BQU0sR0FBRyxHQUE4QixNQUFNLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLFFBQVEsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDO1FBRW5GLGlDQUFpQztRQUNqQyxJQUFJLEdBQUcsQ0FBQyxVQUFVLEVBQUUsT0FBTyxLQUFLLEtBQUssSUFBSSxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDdEQsTUFBTSxJQUFJLENBQUMsNEJBQTRCLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDakQsQ0FBQztRQUVELCtCQUErQjtRQUMvQixJQUFJLEdBQUcsQ0FBQyxRQUFRLEVBQUUsT0FBTyxLQUFLLEtBQUssSUFBSSxHQUFHLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDbEQsTUFBTSxJQUFJLENBQUMsMEJBQTBCLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDL0MsQ0FBQztRQUVELHVDQUF1QztRQUN2QyxJQUFJLENBQUMsR0FBRyxDQUFDLFFBQVEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNuQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxxREFBcUQsQ0FBQyxDQUFDO1FBQzVFLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxLQUFLLENBQUMsMEJBQTBCLENBQUMsR0FBOEI7UUFDbkUsTUFBTSxFQUFFLEdBQUcsR0FBRyxDQUFDLFFBQVMsQ0FBQztRQUN6QixxRUFBcUU7UUFDckUsaUVBQWlFO1FBQ2pFLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksbUJBQW1CLENBQUM7UUFFakQseUJBQXlCO1FBQ3pCLE1BQU0saUJBQWlCLEdBQUcsRUFBRSxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUF3QixFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDM0YsTUFBTSxlQUFlLEdBQUcsRUFBRSxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUM7UUFDM0MsTUFBTSxXQUFXLEdBQUcsaUJBQWlCLElBQUksZUFBZSxDQUFDO1FBRXpELCtCQUErQjtRQUMvQixNQUFNLFlBQVksR0FBRztZQUNqQixZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRTtZQUN4RCxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRTtZQUNuRCxtQkFBbUIsRUFBRSxLQUFLO1lBQzFCLFlBQVksRUFBRSxXQUFXLENBQUMsQ0FBQyxDQUFDLDZCQUFjLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDekUsc0JBQXNCLEVBQUU7Z0JBQ3BCLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUs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QyxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztnQkFDeEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ25DLENBQUM7UUFDTCxDQUFDLENBQUE7UUFFRCxNQUFNLElBQUksRUFBRSxDQUFDO1FBRWIscUJBQXFCO1FBQ3JCLE1BQU0sV0FBVyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBRTFCLGVBQWU7UUFDZixJQUFJLE1BQU0sQ0FBQyxTQUFTLEtBQUssS0FBSyxFQUFFLENBQUM7WUFDN0IsTUFBTSxPQUFPLEdBQUcsSUFBSSx3QkFBVSxDQUFDLE9BQU8sRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDL0MsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUNBQXFDLENBQUMsQ0FBQztnQkFDeEQsTUFBTSxJQUFJLEVBQUUsQ0FBQztZQUNqQixDQUFDLENBQUMsQ0FBQztZQUNILE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNwQixDQUFDO1FBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQztRQUV4QyxPQUFPLFdBQVcsQ0FBQztJQUN2QixDQUFDO0NBRUo7QUE1Y0Qsa0NBNGNDO0FBbFhnQjtJQURaLElBQUEscUJBQVcsR0FBRTtzQ0E2RGIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBcHAsIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBBdHRyaWJ1dGVUeXBlLCBTdHJlYW1WaWV3VHlwZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IElBcHBsaWNhdGlvbkNvbmZpZywgSU9ic2VydmFiaWxpdHlDb25maWcsIElPYnNlcnZhYmlsaXR5SW5mcmFDb25maWcgfSBmcm9tIFwiLi9pbnRlcmZhY2VzL2NvbmZpZ1wiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCB9IGZyb20gXCIuL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBJRncyNE1vZHVsZSB9IGZyb20gXCIuL2NvcmUvcnVudGltZS9tb2R1bGVcIjtcbmltcG9ydCB7IEVudGl0eVVJQ29uZmlnR2VuIH0gZnJvbSBcIi4vdWktY29uZmlnLWdlbi9lbnRpdHktdWktY29uZmlnLmdlblwiO1xuaW1wb3J0IHsgSUxvZ2dlciwgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuL2xvZ2dpbmdcIjtcbmltcG9ydCB7IER5bmFtb0RCQ29uc3RydWN0LCBMYXllckNvbnN0cnVjdCB9IGZyb20gXCIuL2NvbnN0cnVjdHNcIjtcbmltcG9ydCB7IFRpbWVyIH0gZnJvbSBcIi4vdXRpbHNcIjtcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgeyBqb2luIGFzIHBhdGhKb2luLCByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IElTaW11bGF0b3JDb25maWcgfSBmcm9tIFwiLi90ZXN0aW5nL3NpbXVsYXRvci9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBTaW11bGF0b3JDb29yZGluYXRvciB9IGZyb20gXCIuL3Rlc3Rpbmcvc2ltdWxhdG9yL2Nvb3JkaW5hdG9yXCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi9jb3JlL2hlbHBlclwiO1xuaW1wb3J0IHsgSE1SV2F0Y2hlciB9IGZyb20gXCIuL3Rlc3Rpbmcvc2ltdWxhdG9yL2htci13YXRjaGVyXCI7XG5cbmV4cG9ydCBjbGFzcyBBcHBsaWNhdGlvbiB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyOiBJTG9nZ2VyO1xuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgcHVibGljIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQ7XG4gICAgcHVibGljIHJlYWRvbmx5IHVpQ29uZmlnR2VuOiBFbnRpdHlVSUNvbmZpZ0dlbjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbnN0cnVjdHM6IE1hcDxzdHJpbmcsIEZXMjRDb25zdHJ1Y3Q+O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgbW9kdWxlczogTWFwPHN0cmluZywgSUZ3MjRNb2R1bGU+O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgcHJvY2Vzc2VkQ29uc3RydWN0czogTWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj4gPSBuZXcgTWFwKCk7XG4gICAgcHJpdmF0ZSByZWFkb25seSByZXNvdXJjZUNvbnN0cnVjdE1heENvbmN1cnJlbmN5OiBudW1iZXIgPSAxMDtcbiAgICBwcml2YXRlIHJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5ID0gMDtcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9ic2VydmFiaWxpdHlDb25maWc/OiBJT2JzZXJ2YWJpbGl0eUNvbmZpZztcblxuICAgIGNvbnN0cnVjdG9yKGNvbmZpZzogSUFwcGxpY2F0aW9uQ29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dnZXIgPSBjcmVhdGVMb2dnZXIoWyBBcHBsaWNhdGlvbi5uYW1lLCBjb25maWcubmFtZSwgY29uZmlnLmVudmlyb25tZW50IF0uam9pbignLScpKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiSW5pdGlhbGl6aW5nIGZ3MjQgaW5mcmFzdHJ1Y3R1cmUuLi5cIik7XG5cbiAgICAgICAgdGhpcy5mdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgICAgICB0aGlzLnVpQ29uZmlnR2VuID0gbmV3IEVudGl0eVVJQ29uZmlnR2VuKCk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25maWcoY29uZmlnKTtcblxuICAgICAgICBpZiAoY29uZmlnLmVudmlyb25tZW50VmFyaWFibGVzKSB7XG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhjb25maWcuZW52aXJvbm1lbnRWYXJpYWJsZXMpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5nbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcykge1xuICAgICAgICAgICAgT2JqZWN0LmVudHJpZXMoY29uZmlnLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKS5mb3JFYWNoKChbIGtleSwgdmFsdWUgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFwcGx5IGdsb2JhbCBwb2xpY2llcyBmcm9tIGNvbmZpZ1xuICAgICAgICBpZiAoY29uZmlnLmdsb2JhbFBvbGljaWVzKSB7XG4gICAgICAgICAgICBjb25maWcuZ2xvYmFsUG9saWNpZXMuZm9yRWFjaChwb2xpY3kgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5hZGRHbG9iYWxQb2xpY3kocG9saWN5KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXBwbHkgZ2xvYmFsIHJlc291cmNlIGFjY2VzcyBmcm9tIGNvbmZpZ1xuICAgICAgICBpZiAoY29uZmlnLmdsb2JhbFJlc291cmNlQWNjZXNzKSB7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0R2xvYmFsUmVzb3VyY2VBY2Nlc3MoY29uZmlnLmdsb2JhbFJlc291cmNlQWNjZXNzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGVuc3VyZSB0aGVyZSdzIGEgbG9nLWxldmVsIHNldCBpbiB0aGUgZncyNCBzY29wZSBzbyB0aGF0IHRoZSBjb25zdHJ1Y3RzIGNhbiBhc2sgZm9yIHRoaXMgdmFsdWVcbiAgICAgICAgLy8gdGhpcydzIG9ubHkgdGhlIGdsb2JhbCB2YWx1ZSwgYW5kIGNhbiBiZSBvdmVycmlkZGVuIGJ5IGVhY2ggbGFtYmRhIGZ1bmN0aW9uLlxuICAgICAgICBpZiAoIXRoaXMuZncyNC5oYXNFbnZpcm9ubWVudFZhcmlhYmxlKCdMT0dfTEVWRUwnKSkge1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcsIHByb2Nlc3MuZW52LkxPR19MRVZFTCB8fCAnSU5GTycpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU3RvcmUgb2JzZXJ2YWJpbGl0eSBjb25maWcgZm9yIHByb2Nlc3NpbmcgaW4gcnVuKClcbiAgICAgICAgaWYgKGNvbmZpZy5vYnNlcnZhYmlsaXR5KSB7XG4gICAgICAgICAgICB0aGlzLm9ic2VydmFiaWxpdHlDb25maWcgPSBjb25maWcub2JzZXJ2YWJpbGl0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuY29uc3RydWN0cyA9IG5ldyBNYXAoKTtcbiAgICAgICAgdGhpcy5tb2R1bGVzID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIGluaXRpYWxpemUgdGhlIG1haW4gc3RhY2tcbiAgICAgICAgY29uc3QgYXBwID0gbmV3IEFwcCgpO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0QXBwKGFwcCk7XG5cbiAgICB9XG5cbiAgICBwdWJsaWMgdXNlKGNvbnN0cnVjdDogRlcyNENvbnN0cnVjdCk6IHRoaXMge1xuICAgICAgICB0aGlzLnJlZ2lzdGVyQ29uc3RydWN0KGNvbnN0cnVjdCk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHB1YmxpYyB1c2VNb2R1bGUobW9kdWxlOiBJRncyNE1vZHVsZSk6IHRoaXMge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNhbGxlZCBVc2VNb2R1bGUgd2l0aCBtb2R1bGU6IFwiLCB7IG1vZHVsZU5hbWU6IG1vZHVsZS5nZXROYW1lKCkgfSk7XG5cbiAgICAgICAgaWYgKHRoaXMubW9kdWxlcy5oYXMobW9kdWxlLmdldE5hbWUoKSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kdWxlIHdpdGggbmFtZSAke21vZHVsZS5nZXROYW1lKCl9IGlzIGFscmVhZHkgcmVnaXN0ZXJlZC5gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubW9kdWxlcy5zZXQobW9kdWxlLmdldE5hbWUoKSwgbW9kdWxlKTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsgY29uc3RydWN0TmFtZSwgY29uc3RydWN0IF0gb2YgbW9kdWxlLmdldENvbnN0cnVjdHMoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlVzZU1vZHVsZTogUmVnaXN0ZXJpbmcgY29uc3RydWN0OiBcIiwgY29uc3RydWN0TmFtZSwgbW9kdWxlLmdldERlcGVuZGVuY2llcygpLCBjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgIGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMgPSBtb2R1bGUuZ2V0RGVwZW5kZW5jaWVzKCk7XG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ29uc3RydWN0KGNvbnN0cnVjdCwgY29uc3RydWN0TmFtZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBydW4oKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJSdW5uaW5nIGZ3MjQgaW5mcmFzdHJ1Y3R1cmUuLi5cIik7XG5cbiAgICAgICAgLy8gKioqIG9yZGVyIGlzIGltcG9ydGFudCBoZXJlLCBtb2R1bGVzIG5lZWQgdG8gYmUgcHJvY2Vzc2VkIGZpcnN0LCBiZWZvcmUgY29uc3RydWN0cyAqKipcbiAgICAgICAgdGhpcy5wcm9jZXNzTW9kdWxlcygpO1xuXG4gICAgICAgIGNvbnN0IGRpc2FibGVVSUNvbmZpZ0dlbiA9IEZ3MjQuZ2V0SW5zdGFuY2UoKS5nZXRDb25maWcoKS5kaXNhYmxlVUlDb25maWdHZW47XG5cbiAgICAgICAgaWYgKCFkaXNhYmxlVUlDb25maWdHZW4pIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMudWlDb25maWdHZW4ucnVuKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjb25maWd1cmUgYSBidWlsZCBjb21tYW5kIGxpa2UgaW4gcGFja2FnZS5qc29uIHRvIG9ubHkgZ2VuZXJhdGUgdGhlIHVpIGNvbmZpZ1xuICAgICAgICAvLyBcInVpOmdlblwiOiBcIlVJX0dFTl9PTkxZPXRydWUgZW52LWNtZCAtZiAuZW52LmxvY2FsIHRzLW5vZGUgc3JjL2luZGV4LnRzXCJcbiAgICAgICAgLy8gdGhpcyBpcyB1c2VmdWwgZm9yIGdlbmVyYXRpbmcgdGhlIHVpIGNvbmZpZyBkdXJpbmcgZGV2ZWxvcG1lbnRcbiAgICAgICAgaWYgKHByb2Nlc3MuZW52LlVJX0dFTl9PTkxZID09PSAndHJ1ZScpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1VJIGNvbmZpZyBnZW5lcmF0aW9uIGNvbXBsZXRlLiBFeGl0aW5nLicpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGRlZmF1bHQgZncyNCBydW50aW1lIGxheWVyIChPTkxZIHJ1bnRpbWUgY29kZSwgbm90IGluZnJhc3RydWN0dXJlKVxuICAgICAgICAvLyBUaGlzIGxheWVyIGlzIGF1dG9tYXRpY2FsbHkgYXR0YWNoZWQgdG8gYWxsIExhbWJkYSBmdW5jdGlvbnNcbiAgICAgICAgLy8gSXQncyBOT1QgYW4gZW50cnkgcGFja2FnZSAtIGl0J3MganVzdCBhdmFpbGFibGUgZm9yIGltcG9ydHNcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkJ1aWxkaW5nIGZ3MjQgcnVudGltZSBsYXllci4uLlwiKTtcbiAgICAgICAgY29uc3QgZncyNExheWVyID0gbmV3IExheWVyQ29uc3RydWN0KFsge1xuICAgICAgICAgICAgbW9kZTogJ0JVSUxEX0FORF9QQUNLQUdFJyxcbiAgICAgICAgICAgIC8vIEJ1bmRsZSB0aGUgZncyNCBydW50aW1lIHNvdXJjZSAoaGFzIGltcG9ydHMsIG5lZWRzIGJ1bmRsaW5nIHdpdGggZXNidWlsZClcbiAgICAgICAgICAgIHNvdXJjZVBhdGg6ICcuL25vZGVfbW9kdWxlcy9AdGVuMjRncm91cC9mdzI0L2Rpc3QvcGFja2FnZS9sYXllci9mdzI0LmpzJyxcbiAgICAgICAgICAgIHBhY2thZ2VQYXRoOiAnQHRlbjI0Z3JvdXAvZncyNCcsXG4gICAgICAgICAgICBwcmlvcml0eTogMCxcbiAgICAgICAgICAgIC8vIE91dHB1dCB0byBhcHBsaWNhdGlvbidzIGRpc3QvbGF5ZXJzIGRpcmVjdG9yeSwgbm90IGZyYW1ld29yaydzIGRpcmVjdG9yeVxuICAgICAgICAgICAgZGlzdERpcmVjdG9yeTogcGF0aEpvaW4ocHJvY2Vzcy5jd2QoKSwgJ2Rpc3QvbGF5ZXJzJyksXG4gICAgICAgICAgICBidWlsZE9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICAgICAgICAgICAgZXh0ZXJuYWw6IFsgJ0Bhd3Mtc2RrJywgJ0BzbWl0aHknIF0gLy8gQVdTIFNESyBpcyBOT1QgcHJvdmlkZWQgYnkgTGFtYmRhIHJ1bnRpbWVcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBpc0VudHJ5UGFja2FnZTogZmFsc2UsXG4gICAgICAgIH0gXSk7XG4gICAgICAgIGF3YWl0IGZ3MjRMYXllci5jb25zdHJ1Y3QoKTtcblxuICAgICAgICAvLyBCdWlsZCB1c2VyLWRlZmluZWQgbGF5ZXJzIEJFRk9SRSBvYnNlcnZhYmlsaXR5IHNldHVwXG4gICAgICAgIC8vIFRoaXMgZW5zdXJlcyBlbnRyeSBwYWNrYWdlcyBhcmUgcmVnaXN0ZXJlZCBmb3IgYW55IGxhbWJkYXMgY3JlYXRlZCBieSBvYnNlcnZhYmlsaXR5IER5bmFtb0RCXG4gICAgICAgIGF3YWl0IHRoaXMuYnVpbGRVc2VyTGF5ZXJzKCk7XG5cbiAgICAgICAgLy8gU2V0dXAgb2JzZXJ2YWJpbGl0eSBpbmZyYXN0cnVjdHVyZSBBRlRFUiB1c2VyIGxheWVycyBhcmUgYnVpbHRcbiAgICAgICAgLy8gVGhpcyBlbnN1cmVzIGFueSBsYW1iZGFzIGNyZWF0ZWQgYnkgb2JzZXJ2YWJpbGl0eSBoYXZlIGFjY2VzcyB0byBlbnRyeSBwYWNrYWdlc1xuICAgICAgICBpZiAodGhpcy5vYnNlcnZhYmlsaXR5Q29uZmlnKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnNldHVwT2JzZXJ2YWJpbGl0eSh0aGlzLm9ic2VydmFiaWxpdHlDb25maWcpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdG90YWxDb25zdHJ1Y3RzID0gdGhpcy5jb25zdHJ1Y3RzLnNpemU7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCR7Jz0nLnJlcGVhdCg2MCl9YCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCfmoAgQnVpbGRpbmcgJHt0b3RhbENvbnN0cnVjdHN9IGNvbnN0cnVjdChzKS4uLmApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfVxcbmApO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuY29uc3RydWN0QWxsUmVzb3VyY2VzKClcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfWApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgQWxsIGNvbnN0cnVjdHMgY29tcGxldGVkIHN1Y2Nlc3NmdWxseWApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfVxcbmApO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEJ1aWxkIHVzZXItZGVmaW5lZCBsYXllciBjb25zdHJ1Y3RzIGJlZm9yZSBvdGhlciBjb25zdHJ1Y3RzLlxuICAgICAqIFRoaXMgZW5zdXJlcyBlbnRyeSBwYWNrYWdlcyBhcmUgcmVnaXN0ZXJlZCBiZWZvcmUgYW55IGxhbWJkYXMgYXJlIGNyZWF0ZWQuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBidWlsZFVzZXJMYXllcnMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGxheWVyQ29uc3RydWN0cyA9IEFycmF5LmZyb20odGhpcy5jb25zdHJ1Y3RzLmVudHJpZXMoKSlcbiAgICAgICAgICAgIC5maWx0ZXIoKFsgXywgY29uc3RydWN0IF0pID0+IGNvbnN0cnVjdC5uYW1lID09PSAnTGF5ZXJDb25zdHJ1Y3QnKVxuICAgICAgICAgICAgLm1hcCgoWyBuYW1lIF0pID0+IG5hbWUpO1xuXG4gICAgICAgIGlmIChsYXllckNvbnN0cnVjdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBCdWlsZGluZyAke2xheWVyQ29uc3RydWN0cy5sZW5ndGh9IHVzZXIgbGF5ZXIocykgZmlyc3QuLi5gKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGNvbnN0cnVjdE5hbWUgb2YgbGF5ZXJDb25zdHJ1Y3RzKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNvbnN0cnVjdFJlc291cmNlcyhjb25zdHJ1Y3ROYW1lKTtcbiAgICAgICAgfVxuICAgIH1cblxuXG4gICAgcHJpdmF0ZSByZWdpc3RlckNvbnN0cnVjdChjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QsIG5hbWU/OiBzdHJpbmcpIHtcbiAgICAgICAgbGV0IGNvbnN0cnVjdE5hbWUgPSBuYW1lIHx8IGNvbnN0cnVjdC5uYW1lO1xuICAgICAgICBpZiAodGhpcy5jb25zdHJ1Y3RzLmhhcyhjb25zdHJ1Y3ROYW1lKSkge1xuICAgICAgICAgICAgLy8gaGFuZGxlIG11bHRpcGxlIGNvbnN0cnVjdHMgb2Ygc2FtZSB0eXBlXG4gICAgICAgICAgICBjb25zdCBuZXdDb25zdHJ1Y3ROYW1lID0gY29uc3RydWN0TmFtZS5jb25jYXQoJy0nLCByYW5kb21VVUlEKCkpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29uc3RydWN0IHdpdGggbmFtZSAke2NvbnN0cnVjdE5hbWV9IGlzIGFscmVhZHkgcmVnaXN0ZXJlZCwgcmVuYW1pbmcgdG8gJHtuZXdDb25zdHJ1Y3ROYW1lfWApO1xuICAgICAgICAgICAgY29uc3RydWN0TmFtZSA9IG5ld0NvbnN0cnVjdE5hbWU7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5jb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3QpO1xuICAgICAgICB0aGlzLmZ3MjQuYWRkQ29uc3RydWN0KGNvbnN0cnVjdCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBwcm9jZXNzTW9kdWxlcygpIHtcbiAgICAgICAgZm9yIChjb25zdCBbIG1vZHVsZU5hbWUsIG1vZHVsZSBdIG9mIHRoaXMubW9kdWxlcykge1xuICAgICAgICAgICAgdGhpcy5mdzI0LmFkZE1vZHVsZShtb2R1bGVOYW1lLCBtb2R1bGUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjb25zdHJ1Y3RBbGxSZXNvdXJjZXMoKSB7XG4gICAgICAgIGNvbnN0IGFsbENvbnN0cnVjdHMgPSBBcnJheS5mcm9tKHRoaXMuY29uc3RydWN0cy5rZXlzKCkpLm1hcChjb25zdHJ1Y3ROYW1lID0+IHRoaXMuY29uc3RydWN0UmVzb3VyY2VzKGNvbnN0cnVjdE5hbWUpKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKGFsbENvbnN0cnVjdHMpO1xuICAgIH1cblxuICAgIGFzeW5jIGNvbnN0cnVjdFJlc291cmNlcyhjb25zdHJ1Y3ROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgYWxyZWFkeSBwcm9jZXNzZWQgb3IgaW4gcHJvZ3Jlc3MgLSBwcmV2ZW50IGR1cGxpY2F0ZSBidWlsZHNcbiAgICAgICAgaWYgKHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5oYXMoY29uc3RydWN0TmFtZSkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuZ2V0KGNvbnN0cnVjdE5hbWUpITtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvbnN0cnVjdCA9IHRoaXMuY29uc3RydWN0cy5nZXQoY29uc3RydWN0TmFtZSk7XG4gICAgICAgIGlmICghY29uc3RydWN0KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnN0cnVjdCAke2NvbnN0cnVjdE5hbWV9IG5vdCBmb3VuZGApO1xuICAgICAgICB9XG5cbiAgICAgICAgd2hpbGUgKHRoaXMucmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3kgPj0gdGhpcy5yZXNvdXJjZUNvbnN0cnVjdE1heENvbmN1cnJlbmN5KSB7XG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwKSk7IC8vIFRocm90dGxlIGlmIGNvbmN1cnJlbmN5IGxpbWl0IGlzIHJlYWNoZWRcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE9ubHkgbG9nIGlmIHRoZXJlIGFyZSBhY3R1YWwgZGVwZW5kZW5jaWVzXG4gICAgICAgIGlmIChjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzICYmIGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYOKPsyAke2NvbnN0cnVjdE5hbWV9OiBXYWl0aW5nIGZvciBkZXBlbmRlbmNpZXM6ICR7Y29uc3RydWN0LmRlcGVuZGVuY2llcy5qb2luKCcsICcpfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gV2FpdCBmb3IgZGVwZW5kZW5jaWVzIHRvIHJlc29sdmVcbiAgICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yRGVwZW5kZW5jaWVzKGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMsIGNvbnN0cnVjdE5hbWUpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCflKggQnVpbGRpbmcgJHtjb25zdHJ1Y3ROYW1lfS4uLmApO1xuXG4gICAgICAgIHRoaXMucmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3krKztcbiAgICAgICAgY29uc3QgdGltZXIgPSBUaW1lci5zdGFydCgpO1xuICAgICAgICBjb25zdCBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IGNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgJHtjb25zdHJ1Y3ROYW1lfSBjb21wbGV0ZWQgaW4gJHt0aW1lci5lbGFwc2VkU2Vjb25kcygpfWApO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihg4p2MICR7Y29uc3RydWN0TmFtZX0gZmFpbGVkOmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjsgLy8gUmUtdGhyb3cgdG8gZW5zdXJlIGRlcGxveW1lbnQgZmFpbHNcbiAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgdGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeS0tO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KSgpO1xuXG4gICAgICAgIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5zZXQoY29uc3RydWN0TmFtZSwgY29uc3RydWN0Q29tcGxldGlvblByb21pc2UpO1xuICAgICAgICByZXR1cm4gY29uc3RydWN0Q29tcGxldGlvblByb21pc2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yRGVwZW5kZW5jaWVzKGRlcGVuZGVuY2llczogc3RyaW5nW10sIGNvbnN0cnVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAoIWRlcGVuZGVuY2llcyB8fCBkZXBlbmRlbmNpZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwcm9taXNlcyA9IGRlcGVuZGVuY2llcy5tYXAoZGVwZW5kZW5jeSA9PiB7XG4gICAgICAgICAgICAvLyBpZiBkZXBlbmRlbmN5IGNvbnN0cnVjdCBkb2VzIG5vdCBleGlzdHMgaW4gdGhlIGNvbnN0cnVjdCBsaXN0LCBtYXJrIGl0IGFzIHByb2Nlc3NlZFxuICAgICAgICAgICAgaWYgKCF0aGlzLmNvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7Y29uc3RydWN0TmFtZX06IERlcGVuZGVuY3kgJHtkZXBlbmRlbmN5fSBub3QgcmVnaXN0ZXJlZCAob3B0aW9uYWwgZGVwZW5kZW5jeSlgKTtcbiAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuc2V0KGRlcGVuZGVuY3ksIFByb21pc2UucmVzb2x2ZSgpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmhhcyhkZXBlbmRlbmN5KSkge1xuICAgICAgICAgICAgICAgIC8vIElmIGRlcGVuZGVuY3kgbm90IHNjaGVkdWxlZCB5ZXQsIGxpc3RlbiBmb3IgaXRzIGFkZGl0aW9uXG4gICAgICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaW50ZXJ2YWwgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmhhcyhkZXBlbmRlbmN5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwoaW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5nZXQoZGVwZW5kZW5jeSkhLnRoZW4ocmVzb2x2ZSwgcmVqZWN0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSwgMTAwKTsgLy8gQ2hlY2sgZXZlcnkgMTAwbXNcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuZ2V0KGRlcGVuZGVuY3kpITtcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXR1cCBvYnNlcnZhYmlsaXR5IGluZnJhc3RydWN0dXJlLlxuICAgICAqIC0gYHRydWVgID0gRHluYW1vREIgd2l0aCBkZWZhdWx0c1xuICAgICAqIC0gYHsgZHluYW1vZGI6IHsuLi59IH1gID0gRHluYW1vREIgdGFibGVcbiAgICAgKiAtIGB7IGNsb3Vkd2F0Y2g6IHsuLi59IH1gID0gQ3VzdG9tIENsb3VkV2F0Y2ggbG9nIGdyb3VwIChubyBEeW5hbW9EQilcbiAgICAgKiAtIGB7IGR5bmFtb2RiOiB7Li4ufSwgY2xvdWR3YXRjaDogey4uLn0gfWAgPSBCb3RoXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBzZXR1cE9ic2VydmFiaWxpdHkoY29uZmlnOiB0cnVlIHwgSU9ic2VydmFiaWxpdHlJbmZyYUNvbmZpZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAvLyB0cnVlID0gc2hvcnRoYW5kIGZvciB7IGR5bmFtb2RiOiB7fSB9XG4gICAgICAgIGNvbnN0IGNmZzogSU9ic2VydmFiaWxpdHlJbmZyYUNvbmZpZyA9IGNvbmZpZyA9PT0gdHJ1ZSA/IHsgZHluYW1vZGI6IHt9IH0gOiBjb25maWc7XG5cbiAgICAgICAgLy8gU2V0dXAgQ2xvdWRXYXRjaCBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmIChjZmcuY2xvdWR3YXRjaD8uZW5hYmxlZCAhPT0gZmFsc2UgJiYgY2ZnLmNsb3Vkd2F0Y2gpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2V0dXBPYnNlcnZhYmlsaXR5Q2xvdWRXYXRjaChjZmcpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2V0dXAgRHluYW1vREIgaWYgY29uZmlndXJlZFxuICAgICAgICBpZiAoY2ZnLmR5bmFtb2RiPy5lbmFibGVkICE9PSBmYWxzZSAmJiBjZmcuZHluYW1vZGIpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2V0dXBPYnNlcnZhYmlsaXR5RHluYW1vREIoY2ZnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExvZyBpZiBuZWl0aGVyIGJhY2tlbmQgaXMgY29uZmlndXJlZFxuICAgICAgICBpZiAoIWNmZy5keW5hbW9kYiAmJiAhY2ZnLmNsb3Vkd2F0Y2gpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ+KaoO+4jyBPYnNlcnZhYmlsaXR5IGVuYWJsZWQgYnV0IG5vIGJhY2tlbmRzIGNvbmZpZ3VyZWQnKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNldHVwIER5bmFtb0RCIGluZnJhc3RydWN0dXJlIGZvciBvYnNlcnZhYmlsaXR5LlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgc2V0dXBPYnNlcnZhYmlsaXR5RHluYW1vREIoY2ZnOiBJT2JzZXJ2YWJpbGl0eUluZnJhQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGRiID0gY2ZnLmR5bmFtb2RiITtcbiAgICAgICAgLy8gVGFibGUgbmFtZTogdXNlIGRiLm5hbWUgaWYgcHJvdmlkZWQsIG90aGVyd2lzZSAnb2JzZXJ2YWJpbGl0eWxvZ3MnXG4gICAgICAgIC8vIE5vIGFwcE5hbWUgcHJlZml4IC0ga2VlcHMgdGFibGVLZXkgc2ltcGxlIGFuZCBjb252ZW50aW9uLWJhc2VkXG4gICAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IGRiLm5hbWUgPz8gJ29ic2VydmFiaWxpdHlsb2dzJztcblxuICAgICAgICAvLyBDaGVjayBpZiBzdHJlYW0gbmVlZGVkXG4gICAgICAgIGNvbnN0IGhhc1NlYXJjaEluZGV4aW5nID0gZGIuc2VhcmNoSW5kZXhpbmc/LnNvbWUoKHM6IHsgZW5hYmxlZD86IGJvb2xlYW4gfSkgPT4gcy5lbmFibGVkKTtcbiAgICAgICAgY29uc3QgaGFzU3RyZWFtQ29uZmlnID0gZGIuc3RyZWFtPy5lbmFibGVkO1xuICAgICAgICBjb25zdCBuZWVkc1N0cmVhbSA9IGhhc1NlYXJjaEluZGV4aW5nIHx8IGhhc1N0cmVhbUNvbmZpZztcblxuICAgICAgICAvLyBEZWZhdWx0IHRhYmxlIHByb3BzICg2IEdTSXMpXG4gICAgICAgIGNvbnN0IGRlZmF1bHRQcm9wcyA9IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAncGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgc29ydEtleTogeyBuYW1lOiAnc2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IG5lZWRzU3RyZWFtID8gU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgZ2xvYmFsU2Vjb25kYXJ5SW5kZXhlczogW1xuICAgICAgICAgICAgICAgIHsgaW5kZXhOYW1lOiAnZ3NpMScsIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZ3NpMXBrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgc29ydEtleTogeyBuYW1lOiAnZ3NpMXNrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSB9LFxuICAgICAgICAgICAgICAgIHsgaW5kZXhOYW1lOiAnZ3NpMicsIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZ3NpMnBrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgc29ydEtleTogeyBuYW1lOiAnZ3NpMnNrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSB9LFxuICAgICAgICAgICAgICAgIHsgaW5kZXhOYW1lOiAnZ3NpMycsIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZ3NpM3BrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgc29ydEtleTogeyBuYW1lOiAnZ3NpM3NrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSB9LFxuICAgICAgICAgICAgICAgIHsgaW5kZXhOYW1lOiAnZ3NpNCcsIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZ3NpNHBrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgc29ydEtleTogeyBuYW1lOiAnZ3NpNHNrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSB9LFxuICAgICAgICAgICAgICAgIHsgaW5kZXhOYW1lOiAnZ3NpNScsIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZ3NpNXBrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgc29ydEtleTogeyBuYW1lOiAnZ3NpNXNrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSB9LFxuICAgICAgICAgICAgICAgIHsgaW5kZXhOYW1lOiAnZ3NpNicsIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZ3NpNnBrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgc29ydEtleTogeyBuYW1lOiAnZ3NpNnNrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSB9LFxuICAgICAgICAgICAgICAgIHsgaW5kZXhOYW1lOiAnZ3NpNycsIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZ3NpN3BrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgc29ydEtleTogeyBuYW1lOiAnZ3NpN3NrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSB9LFxuICAgICAgICAgICAgICAgIHsgaW5kZXhOYW1lOiAnZ3NpOCcsIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZ3NpOHBrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgc29ydEtleTogeyBuYW1lOiAnZ3NpOHNrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSB9LFxuICAgICAgICAgICAgICAgIHsgaW5kZXhOYW1lOiAnZ3NpOScsIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZ3NpOXBrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgc29ydEtleTogeyBuYW1lOiAnZ3NpOXNrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIC4uLmRiLnByb3BzLFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGR5bmFtb0NvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdCh7XG4gICAgICAgICAgICBzdGFja05hbWU6IGNmZy5zdGFja05hbWUgPz8gJ3BlcnNpc3RlbnQnLFxuICAgICAgICAgICAgcGFyZW50U3RhY2tOYW1lOiBjZmcucGFyZW50U3RhY2tOYW1lLFxuICAgICAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICAgICAgICBuYW1lOiB0YWJsZU5hbWUsXG4gICAgICAgICAgICAgICAgcHJvcHM6IGRlZmF1bHRQcm9wcyxcbiAgICAgICAgICAgICAgICBzdHJlYW06IGRiLnN0cmVhbSxcbiAgICAgICAgICAgICAgICBzZWFyY2hJbmRleGluZzogZGIuc2VhcmNoSW5kZXhpbmcsXG4gICAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBkeW5hbW9Db25zdHJ1Y3QubmFtZSA9ICdvYnNlcnZhYmlsaXR5LWR5bmFtb2RiJztcbiAgICAgICAgYXdhaXQgZHluYW1vQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICAgIC8vIEFkZCBnbG9iYWwgcmVzb3VyY2UgYWNjZXNzIC0gTGFtYmRhRnVuY3Rpb24gc2V0cyBlbnYgdmFyIGF1dG9tYXRpY2FsbHlcbiAgICAgICAgdGhpcy5mdzI0LmFkZEdsb2JhbFJlc291cmNlQWNjZXNzKHtcbiAgICAgICAgICAgIHRhYmxlczogWyB7IG5hbWU6IHRhYmxlTmFtZSwgYWNjZXNzOiBbICdyZWFkd3JpdGUnIF0gfSBdLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xuICAgICAgICBpZiAoaGFzU2VhcmNoSW5kZXhpbmcpIGZlYXR1cmVzLnB1c2goJ3NlYXJjaCcpO1xuICAgICAgICBpZiAoaGFzU3RyZWFtQ29uZmlnKSBmZWF0dXJlcy5wdXNoKCdzdHJlYW0nKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgT2JzZXJ2YWJpbGl0eTogJHt0YWJsZU5hbWV9JHtmZWF0dXJlcy5sZW5ndGggPyAnICgnICsgZmVhdHVyZXMuam9pbignLCAnKSArICcpJyA6ICcnfWApO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNldHVwIENsb3VkV2F0Y2ggaW5mcmFzdHJ1Y3R1cmUgZm9yIG9ic2VydmFiaWxpdHkuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBzZXR1cE9ic2VydmFiaWxpdHlDbG91ZFdhdGNoKGNmZzogSU9ic2VydmFiaWxpdHlJbmZyYUNvbmZpZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCBjdyA9IGNmZy5jbG91ZHdhdGNoITtcbiAgICAgICAgY29uc3QgYXBwTmFtZSA9IHRoaXMuZncyNC5nZXRDb25maWcoKS5uYW1lIHx8ICdhcHAnO1xuICAgICAgICBjb25zdCBsb2dHcm91cE5hbWUgPSBjdy5sb2dHcm91cE5hbWUgPz8gYC9vYnNlcnZhYmlsaXR5LyR7YXBwTmFtZX1gO1xuXG4gICAgICAgIC8vIFRPRE86IENyZWF0ZSBjdXN0b20gbG9nIGdyb3VwIHdoZW4gbmVlZGVkXG4gICAgICAgIC8vIEZvciBub3csIGp1c3Qgc2V0IGVudiB2YXIgc28gcnVudGltZSBjYW4gdXNlIGl0XG4gICAgICAgIHRoaXMuZncyNC5zZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlKCdPQlNFUlZBQklMSVRZX0xPR19HUk9VUCcsIGxvZ0dyb3VwTmFtZSk7XG5cbiAgICAgICAgaWYgKGN3LnJldGVudGlvbkRheXMpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlKCdPQlNFUlZBQklMSVRZX0xPR19SRVRFTlRJT05fREFZUycsIFN0cmluZyhjdy5yZXRlbnRpb25EYXlzKSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgT2JzZXJ2YWJpbGl0eSBDbG91ZFdhdGNoOiAke2xvZ0dyb3VwTmFtZX1gKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTdGFydCB0aGUgbG9jYWwgc2ltdWxhdG9yIGZvciBkZXZlbG9wbWVudC5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgc2ltdWxhdGUoY29uZmlnOiBJU2ltdWxhdG9yQ29uZmlnID0ge30pIHtcbiAgICAgICAgLy8gUHJldmVudCByZWN1cnNpdmUgc2ltdWxhdGUgY2FsbHMgaWYgd2UgYXJlIGN1cnJlbnRseSBzeW50aGVzaXppbmcgYSBibHVlcHJpbnRcbiAgICAgICAgaWYgKHByb2Nlc3MuZW52LkZXMjRfU0lNVUxBVE9SX1NZTkNJTkcgPT09ICd0cnVlJyB8fCBwcm9jZXNzLmVudi5DREtfT1VURElSIHx8IHByb2Nlc3MuZW52LkNES19DT05URVhUX0pTT04pIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJJbnNpZGUgQ0RLIHN5bmMgcHJvY2Vzcywgc2tpcHBpbmcgc2ltdWxhdG9yIHN0YXJ0dXAuXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlN0YXJ0aW5nIEhpZ2gtRmlkZWxpdHkgU2ltdWxhdG9yIChmdzI0IGRldikuLi5cIik7XG5cbiAgICAgICAgY29uc3QgY29vcmRpbmF0b3IgPSBuZXcgU2ltdWxhdG9yQ29vcmRpbmF0b3IoY29uZmlnKTtcblxuICAgICAgICAvLyBQYXNzIGdsb2JhbCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdG8gc2ltdWxhdG9yXG4gICAgICAgIGNvbnN0IGdsb2JhbEVudjogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICAgICAgICB0aGlzLmZ3MjQuZ2V0R2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMoKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICBnbG9iYWxFbnZbIGtleSBdID0gdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoa2V5KTtcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICAvLyBBbHNvIGluY2x1ZGUgc3RhbmRhcmQgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZyb20gY29uZmlnXG4gICAgICAgIGlmICh0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZW52aXJvbm1lbnRWYXJpYWJsZXMpIHtcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oZ2xvYmFsRW52LCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZW52aXJvbm1lbnRWYXJpYWJsZXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29vcmRpbmF0b3Iuc2V0R2xvYmFsRW52KGdsb2JhbEVudik7XG5cbiAgICAgICAgY29uc3Qgc3luYyA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIC8vIFByZXZlbnQgcmVjdXJzaXZlIHN5bmMgY2FsbHMgaWYgc2ltdWxhdGUoKSBpcyBjYWxsZWQgZHVyaW5nIHN5bnRoXG4gICAgICAgICAgICBpZiAocHJvY2Vzcy5lbnYuRlcyNF9TSU1VTEFUT1JfU1lOQ0lORyA9PT0gJ3RydWUnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiU3luY2luZyB3aXRoIENESyBibHVlcHJpbnQuLi5cIik7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgLy8gMS4gUnVuIENESyBTeW50aFxuICAgICAgICAgICAgICAgIGNvbnN0IHsgc3Bhd25TeW5jIH0gPSByZXF1aXJlKCdub2RlOmNoaWxkX3Byb2Nlc3MnKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiUnVubmluZyAnY2RrIHN5bnRoJyB0byBnZW5lcmF0ZSBibHVlcHJpbnQuLi5cIik7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gVW5zZXQgU0lNVUxBVEUgYW5kIHNldCBzZW50aW5lbCB0byBhdm9pZCByZWN1cnNpb25cbiAgICAgICAgICAgICAgICBjb25zdCBlbnYgPSB7IFxuICAgICAgICAgICAgICAgICAgICAuLi5wcm9jZXNzLmVudiwgXG4gICAgICAgICAgICAgICAgICAgIFNJTVVMQVRFOiAnZmFsc2UnLCBcbiAgICAgICAgICAgICAgICAgICAgRlcyNF9TSU1VTEFUT1JfU1lOQ0lORzogJ3RydWUnIFxuICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBzcGF3blN5bmMoJ25weCcsIFsnY2RrJywgJ3N5bnRoJ10sIHsgXG4gICAgICAgICAgICAgICAgICAgIHN0ZGlvOiAnaW5oZXJpdCcsXG4gICAgICAgICAgICAgICAgICAgIHNoZWxsOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBlbnZcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0LnN0YXR1cyAhPT0gMCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihcIuKdjCBDREsgU3ludGggZmFpbGVkLiBTaW11bGF0b3IgY2Fubm90IHN0YXJ0L3N5bmMgd2l0aG91dCBhIHZhbGlkIGJsdWVwcmludC5cIik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKFwiUGxlYXNlIGZpeCB0aGUgZXJyb3JzIGluIHlvdXIgQ0RLL0luZnJhc3RydWN0dXJlIGNvZGUgYW5kIHRoZSBzaW11bGF0b3Igd2lsbCByZXRyeSBvbiB0aGUgbmV4dCBzYXZlLlwiKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIDIuIFN5bmMgQ29vcmRpbmF0b3Igd2l0aCBDREsgYmx1ZXByaW50XG4gICAgICAgICAgICAgICAgYXdhaXQgY29vcmRpbmF0b3Iuc3luY1dpdGhDREsoKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwi4pyFIFNpbXVsYXRvciBzeW5jZWQgd2l0aCBsYXRlc3QgQ0RLIGJsdWVwcmludC5cIik7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoXCLinYwgRXJyb3IgZHVyaW5nIENESyBzeW5jaHJvbml6YXRpb246XCIsIGVycm9yLm1lc3NhZ2UpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGVycm9yLnN0YWNrKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHN5bmMoKTtcblxuICAgICAgICAvLyAzLiBTdGFydCBTaW11bGF0b3JcbiAgICAgICAgYXdhaXQgY29vcmRpbmF0b3Iuc3RhcnQoKTtcblxuICAgICAgICAvLyA0LiBTZXR1cCBITVJcbiAgICAgICAgaWYgKGNvbmZpZy5ob3RSZWxvYWQgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICBjb25zdCB3YXRjaGVyID0gbmV3IEhNUldhdGNoZXIoJy4vc3JjJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJDaGFuZ2UgZGV0ZWN0ZWQsIHJlLXN5bnRoZXNpemluZy4uLlwiKTtcbiAgICAgICAgICAgICAgICBhd2FpdCBzeW5jKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHdhdGNoZXIuc3RhcnQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJTaW11bGF0b3IgaXMgcmVhZHkhXCIpO1xuXG4gICAgICAgIHJldHVybiBjb29yZGluYXRvcjtcbiAgICB9XG5cbn1cbiJdfQ==