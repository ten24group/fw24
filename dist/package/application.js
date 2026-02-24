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
        this.logger.info("Starting High-Fidelity Simulator (fw24 dev)...");
        const coordinator = new coordinator_1.SimulatorCoordinator(config);
        const sync = async () => {
            this.logger.info("Syncing with CDK blueprint...");
            try {
                // 1. Run CDK Synth
                const { spawnSync } = require('node:child_process');
                this.logger.info("Running 'cdk synth' to generate blueprint...");
                const result = spawnSync('npx', ['cdk', 'synth'], {
                    stdio: 'inherit',
                    shell: true
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsNkNBQXlDO0FBQ3pDLDJEQUF5RTtBQUN6RSxzQ0FBbUM7QUFJbkMsK0VBQXlFO0FBQ3pFLHVDQUErRDtBQUMvRCw2Q0FBaUU7QUFDakUsbUNBQWdDO0FBQ2hDLDZDQUF5QztBQUN6Qyx5Q0FBc0Q7QUFFdEQsaUVBQXVFO0FBRXZFLGlFQUE2RDtBQUU3RCxNQUFhLFdBQVc7SUFDWCxNQUFNLENBQVU7SUFDekIsU0FBUyxDQUFTO0lBRUYsSUFBSSxDQUFPO0lBQ1gsV0FBVyxDQUFvQjtJQUM5QixVQUFVLENBQTZCO0lBQ3ZDLE9BQU8sQ0FBMkI7SUFDbEMsbUJBQW1CLEdBQStCLElBQUksR0FBRyxFQUFFLENBQUM7SUFDNUQsK0JBQStCLEdBQVcsRUFBRSxDQUFDO0lBQ3RELG1DQUFtQyxHQUFHLENBQUMsQ0FBQztJQUMvQixtQkFBbUIsQ0FBd0I7SUFFNUQsWUFBWSxTQUE2QixFQUFFO1FBQ3ZDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLENBQUUsV0FBVyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxXQUFXLENBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUU1RixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO1FBRXhELElBQUksQ0FBQyxJQUFJLEdBQUcsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQy9CLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSx3Q0FBaUIsRUFBRSxDQUFDO1FBQzNDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRTVCLElBQUksTUFBTSxDQUFDLG9CQUFvQixFQUFFLENBQUM7WUFD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QUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUs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Q0FBQztnQkFDbEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMscUNBQXFDLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO2dCQUN4RSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDbkMsQ0FBQztRQUNMLENBQUMsQ0FBQTtRQUVELE1BQU0sSUFBSSxFQUFFLENBQUM7UUFFYixxQkFBcUI7UUFDckIsTUFBTSxXQUFXLENBQUMsS0FBSyxFQUFFLENBQUM7UUFFMUIsZUFBZTtRQUNmLElBQUksTUFBTSxDQUFDLFNBQVMsS0FBSyxLQUFLLEVBQUUsQ0FBQztZQUM3QixNQUFNLE9BQU8sR0FBRyxJQUFJLHdCQUFVLENBQUMsT0FBTyxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUMvQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO2dCQUN4RCxNQUFNLElBQUksRUFBRSxDQUFDO1lBQ2pCLENBQUMsQ0FBQyxDQUFDO1lBQ0gsT0FBTyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3BCLENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO1FBRXhDLE9BQU8sV0FBVyxDQUFDO0lBQ3ZCLENBQUM7Q0FFSjtBQTNhRCxrQ0EyYUM7QUFqVmdCO0lBRFosSUFBQSxxQkFBVyxHQUFFO3NDQTZEYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFwcCwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IEF0dHJpYnV0ZVR5cGUsIFN0cmVhbVZpZXdUeXBlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1keW5hbW9kYlwiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgSUFwcGxpY2F0aW9uQ29uZmlnLCBJT2JzZXJ2YWJpbGl0eUNvbmZpZywgSU9ic2VydmFiaWxpdHlJbmZyYUNvbmZpZyB9IGZyb20gXCIuL2ludGVyZmFjZXMvY29uZmlnXCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0IH0gZnJvbSBcIi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IElGdzI0TW9kdWxlIH0gZnJvbSBcIi4vY29yZS9ydW50aW1lL21vZHVsZVwiO1xuaW1wb3J0IHsgRW50aXR5VUlDb25maWdHZW4gfSBmcm9tIFwiLi91aS1jb25maWctZ2VuL2VudGl0eS11aS1jb25maWcuZ2VuXCI7XG5pbXBvcnQgeyBJTG9nZ2VyLCBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgRHluYW1vREJDb25zdHJ1Y3QsIExheWVyQ29uc3RydWN0IH0gZnJvbSBcIi4vY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgVGltZXIgfSBmcm9tIFwiLi91dGlsc1wiO1xuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ25vZGU6Y3J5cHRvJztcbmltcG9ydCB7IGpvaW4gYXMgcGF0aEpvaW4sIHJlc29sdmUgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgSVNpbXVsYXRvckNvbmZpZyB9IGZyb20gXCIuL3Rlc3Rpbmcvc2ltdWxhdG9yL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IFNpbXVsYXRvckNvb3JkaW5hdG9yIH0gZnJvbSBcIi4vdGVzdGluZy9zaW11bGF0b3IvY29vcmRpbmF0b3JcIjtcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuL2NvcmUvaGVscGVyXCI7XG5pbXBvcnQgeyBITVJXYXRjaGVyIH0gZnJvbSBcIi4vdGVzdGluZy9zaW11bGF0b3IvaG1yLXdhdGNoZXJcIjtcblxuZXhwb3J0IGNsYXNzIEFwcGxpY2F0aW9uIHtcbiAgICByZWFkb25seSBsb2dnZXI6IElMb2dnZXI7XG4gICAgbWFpblN0YWNrITogU3RhY2s7XG5cbiAgICBwdWJsaWMgcmVhZG9ubHkgZncyNDogRncyNDtcbiAgICBwdWJsaWMgcmVhZG9ubHkgdWlDb25maWdHZW46IEVudGl0eVVJQ29uZmlnR2VuO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY29uc3RydWN0czogTWFwPHN0cmluZywgRlcyNENvbnN0cnVjdD47XG4gICAgcHJpdmF0ZSByZWFkb25seSBtb2R1bGVzOiBNYXA8c3RyaW5nLCBJRncyNE1vZHVsZT47XG4gICAgcHJpdmF0ZSByZWFkb25seSBwcm9jZXNzZWRDb25zdHJ1Y3RzOiBNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+PiA9IG5ldyBNYXAoKTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJlc291cmNlQ29uc3RydWN0TWF4Q29uY3VycmVuY3k6IG51bWJlciA9IDEwO1xuICAgIHByaXZhdGUgcmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3kgPSAwO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgb2JzZXJ2YWJpbGl0eUNvbmZpZz86IElPYnNlcnZhYmlsaXR5Q29uZmlnO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnOiBJQXBwbGljYXRpb25Db25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihbIEFwcGxpY2F0aW9uLm5hbWUsIGNvbmZpZy5uYW1lLCBjb25maWcuZW52aXJvbm1lbnQgXS5qb2luKCctJykpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJJbml0aWFsaXppbmcgZncyNCBpbmZyYXN0cnVjdHVyZS4uLlwiKTtcblxuICAgICAgICB0aGlzLmZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgICAgIHRoaXMudWlDb25maWdHZW4gPSBuZXcgRW50aXR5VUlDb25maWdHZW4oKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbmZpZyhjb25maWcpO1xuXG4gICAgICAgIGlmIChjb25maWcuZW52aXJvbm1lbnRWYXJpYWJsZXMpIHtcbiAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKGNvbmZpZy5lbnZpcm9ubWVudFZhcmlhYmxlcykuZm9yRWFjaCgoWyBrZXksIHZhbHVlIF0pID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKSB7XG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhjb25maWcuZ2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXBwbHkgZ2xvYmFsIHBvbGljaWVzIGZyb20gY29uZmlnXG4gICAgICAgIGlmIChjb25maWcuZ2xvYmFsUG9saWNpZXMpIHtcbiAgICAgICAgICAgIGNvbmZpZy5nbG9iYWxQb2xpY2llcy5mb3JFYWNoKHBvbGljeSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LmFkZEdsb2JhbFBvbGljeShwb2xpY3kpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBcHBseSBnbG9iYWwgcmVzb3VyY2UgYWNjZXNzIGZyb20gY29uZmlnXG4gICAgICAgIGlmIChjb25maWcuZ2xvYmFsUmVzb3VyY2VBY2Nlc3MpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRHbG9iYWxSZXNvdXJjZUFjY2Vzcyhjb25maWcuZ2xvYmFsUmVzb3VyY2VBY2Nlc3MpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gZW5zdXJlIHRoZXJlJ3MgYSBsb2ctbGV2ZWwgc2V0IGluIHRoZSBmdzI0IHNjb3BlIHNvIHRoYXQgdGhlIGNvbnN0cnVjdHMgY2FuIGFzayBmb3IgdGhpcyB2YWx1ZVxuICAgICAgICAvLyB0aGlzJ3Mgb25seSB0aGUgZ2xvYmFsIHZhbHVlLCBhbmQgY2FuIGJlIG92ZXJyaWRkZW4gYnkgZWFjaCBsYW1iZGEgZnVuY3Rpb24uXG4gICAgICAgIGlmICghdGhpcy5mdzI0Lmhhc0Vudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcpKSB7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnTE9HX0xFVkVMJywgcHJvY2Vzcy5lbnYuTE9HX0xFVkVMIHx8ICdJTkZPJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTdG9yZSBvYnNlcnZhYmlsaXR5IGNvbmZpZyBmb3IgcHJvY2Vzc2luZyBpbiBydW4oKVxuICAgICAgICBpZiAoY29uZmlnLm9ic2VydmFiaWxpdHkpIHtcbiAgICAgICAgICAgIHRoaXMub2JzZXJ2YWJpbGl0eUNvbmZpZyA9IGNvbmZpZy5vYnNlcnZhYmlsaXR5O1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5jb25zdHJ1Y3RzID0gbmV3IE1hcCgpO1xuICAgICAgICB0aGlzLm1vZHVsZXMgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gaW5pdGlhbGl6ZSB0aGUgbWFpbiBzdGFja1xuICAgICAgICBjb25zdCBhcHAgPSBuZXcgQXBwKCk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRBcHAoYXBwKTtcblxuICAgIH1cblxuICAgIHB1YmxpYyB1c2UoY29uc3RydWN0OiBGVzI0Q29uc3RydWN0KTogdGhpcyB7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0KTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgcHVibGljIHVzZU1vZHVsZShtb2R1bGU6IElGdzI0TW9kdWxlKTogdGhpcyB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ2FsbGVkIFVzZU1vZHVsZSB3aXRoIG1vZHVsZTogXCIsIHsgbW9kdWxlTmFtZTogbW9kdWxlLmdldE5hbWUoKSB9KTtcblxuICAgICAgICBpZiAodGhpcy5tb2R1bGVzLmhhcyhtb2R1bGUuZ2V0TmFtZSgpKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2R1bGUgd2l0aCBuYW1lICR7bW9kdWxlLmdldE5hbWUoKX0gaXMgYWxyZWFkeSByZWdpc3RlcmVkLmApO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5tb2R1bGVzLnNldChtb2R1bGUuZ2V0TmFtZSgpLCBtb2R1bGUpO1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3QgXSBvZiBtb2R1bGUuZ2V0Q29uc3RydWN0cygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiVXNlTW9kdWxlOiBSZWdpc3RlcmluZyBjb25zdHJ1Y3Q6IFwiLCBjb25zdHJ1Y3ROYW1lLCBtb2R1bGUuZ2V0RGVwZW5kZW5jaWVzKCksIGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgY29uc3RydWN0LmRlcGVuZGVuY2llcyA9IG1vZHVsZS5nZXREZXBlbmRlbmNpZXMoKTtcbiAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0LCBjb25zdHJ1Y3ROYW1lKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHVibGljIGFzeW5jIHJ1bigpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlJ1bm5pbmcgZncyNCBpbmZyYXN0cnVjdHVyZS4uLlwiKTtcblxuICAgICAgICAvLyAqKiogb3JkZXIgaXMgaW1wb3J0YW50IGhlcmUsIG1vZHVsZXMgbmVlZCB0byBiZSBwcm9jZXNzZWQgZmlyc3QsIGJlZm9yZSBjb25zdHJ1Y3RzICoqKlxuICAgICAgICB0aGlzLnByb2Nlc3NNb2R1bGVzKCk7XG5cbiAgICAgICAgY29uc3QgZGlzYWJsZVVJQ29uZmlnR2VuID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldENvbmZpZygpLmRpc2FibGVVSUNvbmZpZ0dlbjtcblxuICAgICAgICBpZiAoIWRpc2FibGVVSUNvbmZpZ0dlbikge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy51aUNvbmZpZ0dlbi5ydW4oKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNvbmZpZ3VyZSBhIGJ1aWxkIGNvbW1hbmQgbGlrZSBpbiBwYWNrYWdlLmpzb24gdG8gb25seSBnZW5lcmF0ZSB0aGUgdWkgY29uZmlnXG4gICAgICAgIC8vIFwidWk6Z2VuXCI6IFwiVUlfR0VOX09OTFk9dHJ1ZSBlbnYtY21kIC1mIC5lbnYubG9jYWwgdHMtbm9kZSBzcmMvaW5kZXgudHNcIlxuICAgICAgICAvLyB0aGlzIGlzIHVzZWZ1bCBmb3IgZ2VuZXJhdGluZyB0aGUgdWkgY29uZmlnIGR1cmluZyBkZXZlbG9wbWVudFxuICAgICAgICBpZiAocHJvY2Vzcy5lbnYuVUlfR0VOX09OTFkgPT09ICd0cnVlJykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnVUkgY29uZmlnIGdlbmVyYXRpb24gY29tcGxldGUuIEV4aXRpbmcuJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgZGVmYXVsdCBmdzI0IHJ1bnRpbWUgbGF5ZXIgKE9OTFkgcnVudGltZSBjb2RlLCBub3QgaW5mcmFzdHJ1Y3R1cmUpXG4gICAgICAgIC8vIFRoaXMgbGF5ZXIgaXMgYXV0b21hdGljYWxseSBhdHRhY2hlZCB0byBhbGwgTGFtYmRhIGZ1bmN0aW9uc1xuICAgICAgICAvLyBJdCdzIE5PVCBhbiBlbnRyeSBwYWNrYWdlIC0gaXQncyBqdXN0IGF2YWlsYWJsZSBmb3IgaW1wb3J0c1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQnVpbGRpbmcgZncyNCBydW50aW1lIGxheWVyLi4uXCIpO1xuICAgICAgICBjb25zdCBmdzI0TGF5ZXIgPSBuZXcgTGF5ZXJDb25zdHJ1Y3QoWyB7XG4gICAgICAgICAgICBtb2RlOiAnQlVJTERfQU5EX1BBQ0tBR0UnLFxuICAgICAgICAgICAgLy8gQnVuZGxlIHRoZSBmdzI0IHJ1bnRpbWUgc291cmNlIChoYXMgaW1wb3J0cywgbmVlZHMgYnVuZGxpbmcgd2l0aCBlc2J1aWxkKVxuICAgICAgICAgICAgc291cmNlUGF0aDogJy4vbm9kZV9tb2R1bGVzL0B0ZW4yNGdyb3VwL2Z3MjQvZGlzdC9wYWNrYWdlL2xheWVyL2Z3MjQuanMnLFxuICAgICAgICAgICAgcGFja2FnZVBhdGg6ICdAdGVuMjRncm91cC9mdzI0JyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAwLFxuICAgICAgICAgICAgLy8gT3V0cHV0IHRvIGFwcGxpY2F0aW9uJ3MgZGlzdC9sYXllcnMgZGlyZWN0b3J5LCBub3QgZnJhbWV3b3JrJ3MgZGlyZWN0b3J5XG4gICAgICAgICAgICBkaXN0RGlyZWN0b3J5OiBwYXRoSm9pbihwcm9jZXNzLmN3ZCgpLCAnZGlzdC9sYXllcnMnKSxcbiAgICAgICAgICAgIGJ1aWxkT3B0aW9uczoge1xuICAgICAgICAgICAgICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBleHRlcm5hbDogWyAnQGF3cy1zZGsnLCAnQHNtaXRoeScgXSAvLyBBV1MgU0RLIGlzIE5PVCBwcm92aWRlZCBieSBMYW1iZGEgcnVudGltZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGlzRW50cnlQYWNrYWdlOiBmYWxzZSxcbiAgICAgICAgfSBdKTtcbiAgICAgICAgYXdhaXQgZncyNExheWVyLmNvbnN0cnVjdCgpO1xuXG4gICAgICAgIC8vIEJ1aWxkIHVzZXItZGVmaW5lZCBsYXllcnMgQkVGT1JFIG9ic2VydmFiaWxpdHkgc2V0dXBcbiAgICAgICAgLy8gVGhpcyBlbnN1cmVzIGVudHJ5IHBhY2thZ2VzIGFyZSByZWdpc3RlcmVkIGZvciBhbnkgbGFtYmRhcyBjcmVhdGVkIGJ5IG9ic2VydmFiaWxpdHkgRHluYW1vREJcbiAgICAgICAgYXdhaXQgdGhpcy5idWlsZFVzZXJMYXllcnMoKTtcblxuICAgICAgICAvLyBTZXR1cCBvYnNlcnZhYmlsaXR5IGluZnJhc3RydWN0dXJlIEFGVEVSIHVzZXIgbGF5ZXJzIGFyZSBidWlsdFxuICAgICAgICAvLyBUaGlzIGVuc3VyZXMgYW55IGxhbWJkYXMgY3JlYXRlZCBieSBvYnNlcnZhYmlsaXR5IGhhdmUgYWNjZXNzIHRvIGVudHJ5IHBhY2thZ2VzXG4gICAgICAgIGlmICh0aGlzLm9ic2VydmFiaWxpdHlDb25maWcpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2V0dXBPYnNlcnZhYmlsaXR5KHRoaXMub2JzZXJ2YWJpbGl0eUNvbmZpZyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0b3RhbENvbnN0cnVjdHMgPSB0aGlzLmNvbnN0cnVjdHMuc2l6ZTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgJHsnPScucmVwZWF0KDYwKX1gKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg8J+agCBCdWlsZGluZyAke3RvdGFsQ29uc3RydWN0c30gY29uc3RydWN0KHMpLi4uYCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCR7Jz0nLnJlcGVhdCg2MCl9XFxuYCk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5jb25zdHJ1Y3RBbGxSZXNvdXJjZXMoKVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCR7Jz0nLnJlcGVhdCg2MCl9YCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSBBbGwgY29uc3RydWN0cyBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5YCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCR7Jz0nLnJlcGVhdCg2MCl9XFxuYCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQnVpbGQgdXNlci1kZWZpbmVkIGxheWVyIGNvbnN0cnVjdHMgYmVmb3JlIG90aGVyIGNvbnN0cnVjdHMuXG4gICAgICogVGhpcyBlbnN1cmVzIGVudHJ5IHBhY2thZ2VzIGFyZSByZWdpc3RlcmVkIGJlZm9yZSBhbnkgbGFtYmRhcyBhcmUgY3JlYXRlZC5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIGJ1aWxkVXNlckxheWVycygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgbGF5ZXJDb25zdHJ1Y3RzID0gQXJyYXkuZnJvbSh0aGlzLmNvbnN0cnVjdHMuZW50cmllcygpKVxuICAgICAgICAgICAgLmZpbHRlcigoWyBfLCBjb25zdHJ1Y3QgXSkgPT4gY29uc3RydWN0Lm5hbWUgPT09ICdMYXllckNvbnN0cnVjdCcpXG4gICAgICAgICAgICAubWFwKChbIG5hbWUgXSkgPT4gbmFtZSk7XG5cbiAgICAgICAgaWYgKGxheWVyQ29uc3RydWN0cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEJ1aWxkaW5nICR7bGF5ZXJDb25zdHJ1Y3RzLmxlbmd0aH0gdXNlciBsYXllcihzKSBmaXJzdC4uLmApO1xuXG4gICAgICAgIGZvciAoY29uc3QgY29uc3RydWN0TmFtZSBvZiBsYXllckNvbnN0cnVjdHMpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29uc3RydWN0UmVzb3VyY2VzKGNvbnN0cnVjdE5hbWUpO1xuICAgICAgICB9XG4gICAgfVxuXG5cbiAgICBwcml2YXRlIHJlZ2lzdGVyQ29uc3RydWN0KGNvbnN0cnVjdDogRlcyNENvbnN0cnVjdCwgbmFtZT86IHN0cmluZykge1xuICAgICAgICBsZXQgY29uc3RydWN0TmFtZSA9IG5hbWUgfHwgY29uc3RydWN0Lm5hbWU7XG4gICAgICAgIGlmICh0aGlzLmNvbnN0cnVjdHMuaGFzKGNvbnN0cnVjdE5hbWUpKSB7XG4gICAgICAgICAgICAvLyBoYW5kbGUgbXVsdGlwbGUgY29uc3RydWN0cyBvZiBzYW1lIHR5cGVcbiAgICAgICAgICAgIGNvbnN0IG5ld0NvbnN0cnVjdE5hbWUgPSBjb25zdHJ1Y3ROYW1lLmNvbmNhdCgnLScsIHJhbmRvbVVVSUQoKSk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDb25zdHJ1Y3Qgd2l0aCBuYW1lICR7Y29uc3RydWN0TmFtZX0gaXMgYWxyZWFkeSByZWdpc3RlcmVkLCByZW5hbWluZyB0byAke25ld0NvbnN0cnVjdE5hbWV9YCk7XG4gICAgICAgICAgICBjb25zdHJ1Y3ROYW1lID0gbmV3Q29uc3RydWN0TmFtZTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmNvbnN0cnVjdHMuc2V0KGNvbnN0cnVjdE5hbWUsIGNvbnN0cnVjdCk7XG4gICAgICAgIHRoaXMuZncyNC5hZGRDb25zdHJ1Y3QoY29uc3RydWN0KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHByb2Nlc3NNb2R1bGVzKCkge1xuICAgICAgICBmb3IgKGNvbnN0IFsgbW9kdWxlTmFtZSwgbW9kdWxlIF0gb2YgdGhpcy5tb2R1bGVzKSB7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuYWRkTW9kdWxlKG1vZHVsZU5hbWUsIG1vZHVsZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGNvbnN0cnVjdEFsbFJlc291cmNlcygpIHtcbiAgICAgICAgY29uc3QgYWxsQ29uc3RydWN0cyA9IEFycmF5LmZyb20odGhpcy5jb25zdHJ1Y3RzLmtleXMoKSkubWFwKGNvbnN0cnVjdE5hbWUgPT4gdGhpcy5jb25zdHJ1Y3RSZXNvdXJjZXMoY29uc3RydWN0TmFtZSkpO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoYWxsQ29uc3RydWN0cyk7XG4gICAgfVxuXG4gICAgYXN5bmMgY29uc3RydWN0UmVzb3VyY2VzKGNvbnN0cnVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAvLyBDaGVjayBpZiBhbHJlYWR5IHByb2Nlc3NlZCBvciBpbiBwcm9ncmVzcyAtIHByZXZlbnQgZHVwbGljYXRlIGJ1aWxkc1xuICAgICAgICBpZiAodGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmhhcyhjb25zdHJ1Y3ROYW1lKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5nZXQoY29uc3RydWN0TmFtZSkhO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY29uc3RydWN0ID0gdGhpcy5jb25zdHJ1Y3RzLmdldChjb25zdHJ1Y3ROYW1lKTtcbiAgICAgICAgaWYgKCFjb25zdHJ1Y3QpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29uc3RydWN0ICR7Y29uc3RydWN0TmFtZX0gbm90IGZvdW5kYCk7XG4gICAgICAgIH1cblxuICAgICAgICB3aGlsZSAodGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSA+PSB0aGlzLnJlc291cmNlQ29uc3RydWN0TWF4Q29uY3VycmVuY3kpIHtcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDApKTsgLy8gVGhyb3R0bGUgaWYgY29uY3VycmVuY3kgbGltaXQgaXMgcmVhY2hlZFxuICAgICAgICB9XG5cbiAgICAgICAgLy8gT25seSBsb2cgaWYgdGhlcmUgYXJlIGFjdHVhbCBkZXBlbmRlbmNpZXNcbiAgICAgICAgaWYgKGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMgJiYgY29uc3RydWN0LmRlcGVuZGVuY2llcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhg4o+zICR7Y29uc3RydWN0TmFtZX06IFdhaXRpbmcgZm9yIGRlcGVuZGVuY2llczogJHtjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBXYWl0IGZvciBkZXBlbmRlbmNpZXMgdG8gcmVzb2x2ZVxuICAgICAgICBhd2FpdCB0aGlzLndhaXRGb3JEZXBlbmRlbmNpZXMoY29uc3RydWN0LmRlcGVuZGVuY2llcywgY29uc3RydWN0TmFtZSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg8J+UqCBCdWlsZGluZyAke2NvbnN0cnVjdE5hbWV9Li4uYCk7XG5cbiAgICAgICAgdGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSsrO1xuICAgICAgICBjb25zdCB0aW1lciA9IFRpbWVyLnN0YXJ0KCk7XG4gICAgICAgIGNvbnN0IGNvbnN0cnVjdENvbXBsZXRpb25Qcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgY29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSAke2NvbnN0cnVjdE5hbWV9IGNvbXBsZXRlZCBpbiAke3RpbWVyLmVsYXBzZWRTZWNvbmRzKCl9YCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGDinYwgJHtjb25zdHJ1Y3ROYW1lfSBmYWlsZWQ6YCwgZXJyb3IpO1xuICAgICAgICAgICAgICAgIHRocm93IGVycm9yOyAvLyBSZS10aHJvdyB0byBlbnN1cmUgZGVwbG95bWVudCBmYWlsc1xuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5LS07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKCk7XG5cbiAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZSk7XG4gICAgICAgIHJldHVybiBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHdhaXRGb3JEZXBlbmRlbmNpZXMoZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSwgY29uc3RydWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghZGVwZW5kZW5jaWVzIHx8IGRlcGVuZGVuY2llcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gZGVwZW5kZW5jaWVzLm1hcChkZXBlbmRlbmN5ID0+IHtcbiAgICAgICAgICAgIC8vIGlmIGRlcGVuZGVuY3kgY29uc3RydWN0IGRvZXMgbm90IGV4aXN0cyBpbiB0aGUgY29uc3RydWN0IGxpc3QsIG1hcmsgaXQgYXMgcHJvY2Vzc2VkXG4gICAgICAgICAgICBpZiAoIXRoaXMuY29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtjb25zdHJ1Y3ROYW1lfTogRGVwZW5kZW5jeSAke2RlcGVuZGVuY3l9IG5vdCByZWdpc3RlcmVkIChvcHRpb25hbCBkZXBlbmRlbmN5KWApO1xuICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5zZXQoZGVwZW5kZW5jeSwgUHJvbWlzZS5yZXNvbHZlKCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCF0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgLy8gSWYgZGVwZW5kZW5jeSBub3Qgc2NoZWR1bGVkIHlldCwgbGlzdGVuIGZvciBpdHMgYWRkaXRpb25cbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJJbnRlcnZhbChpbnRlcnZhbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmdldChkZXBlbmRlbmN5KSEudGhlbihyZXNvbHZlLCByZWplY3QpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LCAxMDApOyAvLyBDaGVjayBldmVyeSAxMDBtc1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5nZXQoZGVwZW5kZW5jeSkhO1xuICAgICAgICB9KTtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNldHVwIG9ic2VydmFiaWxpdHkgaW5mcmFzdHJ1Y3R1cmUuXG4gICAgICogLSBgdHJ1ZWAgPSBEeW5hbW9EQiB3aXRoIGRlZmF1bHRzXG4gICAgICogLSBgeyBkeW5hbW9kYjogey4uLn0gfWAgPSBEeW5hbW9EQiB0YWJsZVxuICAgICAqIC0gYHsgY2xvdWR3YXRjaDogey4uLn0gfWAgPSBDdXN0b20gQ2xvdWRXYXRjaCBsb2cgZ3JvdXAgKG5vIER5bmFtb0RCKVxuICAgICAqIC0gYHsgZHluYW1vZGI6IHsuLi59LCBjbG91ZHdhdGNoOiB7Li4ufSB9YCA9IEJvdGhcbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHNldHVwT2JzZXJ2YWJpbGl0eShjb25maWc6IHRydWUgfCBJT2JzZXJ2YWJpbGl0eUluZnJhQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIHRydWUgPSBzaG9ydGhhbmQgZm9yIHsgZHluYW1vZGI6IHt9IH1cbiAgICAgICAgY29uc3QgY2ZnOiBJT2JzZXJ2YWJpbGl0eUluZnJhQ29uZmlnID0gY29uZmlnID09PSB0cnVlID8geyBkeW5hbW9kYjoge30gfSA6IGNvbmZpZztcblxuICAgICAgICAvLyBTZXR1cCBDbG91ZFdhdGNoIGlmIGNvbmZpZ3VyZWRcbiAgICAgICAgaWYgKGNmZy5jbG91ZHdhdGNoPy5lbmFibGVkICE9PSBmYWxzZSAmJiBjZmcuY2xvdWR3YXRjaCkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5zZXR1cE9ic2VydmFiaWxpdHlDbG91ZFdhdGNoKGNmZyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTZXR1cCBEeW5hbW9EQiBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmIChjZmcuZHluYW1vZGI/LmVuYWJsZWQgIT09IGZhbHNlICYmIGNmZy5keW5hbW9kYikge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5zZXR1cE9ic2VydmFiaWxpdHlEeW5hbW9EQihjZmcpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTG9nIGlmIG5laXRoZXIgYmFja2VuZCBpcyBjb25maWd1cmVkXG4gICAgICAgIGlmICghY2ZnLmR5bmFtb2RiICYmICFjZmcuY2xvdWR3YXRjaCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygn4pqg77iPIE9ic2VydmFiaWxpdHkgZW5hYmxlZCBidXQgbm8gYmFja2VuZHMgY29uZmlndXJlZCcpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0dXAgRHluYW1vREIgaW5mcmFzdHJ1Y3R1cmUgZm9yIG9ic2VydmFiaWxpdHkuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBzZXR1cE9ic2VydmFiaWxpdHlEeW5hbW9EQihjZmc6IElPYnNlcnZhYmlsaXR5SW5mcmFDb25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgZGIgPSBjZmcuZHluYW1vZGIhO1xuICAgICAgICAvLyBUYWJsZSBuYW1lOiB1c2UgZGIubmFtZSBpZiBwcm92aWRlZCwgb3RoZXJ3aXNlICdvYnNlcnZhYmlsaXR5bG9ncydcbiAgICAgICAgLy8gTm8gYXBwTmFtZSBwcmVmaXggLSBrZWVwcyB0YWJsZUtleSBzaW1wbGUgYW5kIGNvbnZlbnRpb24tYmFzZWRcbiAgICAgICAgY29uc3QgdGFibGVOYW1lID0gZGIubmFtZSA/PyAnb2JzZXJ2YWJpbGl0eWxvZ3MnO1xuXG4gICAgICAgIC8vIENoZWNrIGlmIHN0cmVhbSBuZWVkZWRcbiAgICAgICAgY29uc3QgaGFzU2VhcmNoSW5kZXhpbmcgPSBkYi5zZWFyY2hJbmRleGluZz8uc29tZSgoczogeyBlbmFibGVkPzogYm9vbGVhbiB9KSA9PiBzLmVuYWJsZWQpO1xuICAgICAgICBjb25zdCBoYXNTdHJlYW1Db25maWcgPSBkYi5zdHJlYW0/LmVuYWJsZWQ7XG4gICAgICAgIGNvbnN0IG5lZWRzU3RyZWFtID0gaGFzU2VhcmNoSW5kZXhpbmcgfHwgaGFzU3RyZWFtQ29uZmlnO1xuXG4gICAgICAgIC8vIERlZmF1bHQgdGFibGUgcHJvcHMgKDYgR1NJcylcbiAgICAgICAgY29uc3QgZGVmYXVsdFByb3BzID0ge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdwaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogbmVlZHNTdHJlYW0gPyBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBnbG9iYWxTZWNvbmRhcnlJbmRleGVzOiBbXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2kxJywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2kxcGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2kxc2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2kyJywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2kycGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2kyc2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2kzJywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2kzcGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2kzc2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k0JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k0cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k0c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k1JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k1cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k1c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k2JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k2cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k2c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k3JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k3cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k3c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k4JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k4cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k4c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k5JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k5cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k5c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgLi4uZGIucHJvcHMsXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgZHluYW1vQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KHtcbiAgICAgICAgICAgIHN0YWNrTmFtZTogY2ZnLnN0YWNrTmFtZSA/PyAncGVyc2lzdGVudCcsXG4gICAgICAgICAgICBwYXJlbnRTdGFja05hbWU6IGNmZy5wYXJlbnRTdGFja05hbWUsXG4gICAgICAgICAgICB0YWJsZToge1xuICAgICAgICAgICAgICAgIG5hbWU6IHRhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICBwcm9wczogZGVmYXVsdFByb3BzLFxuICAgICAgICAgICAgICAgIHN0cmVhbTogZGIuc3RyZWFtLFxuICAgICAgICAgICAgICAgIHNlYXJjaEluZGV4aW5nOiBkYi5zZWFyY2hJbmRleGluZyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGR5bmFtb0NvbnN0cnVjdC5uYW1lID0gJ29ic2VydmFiaWxpdHktZHluYW1vZGInO1xuICAgICAgICBhd2FpdCBkeW5hbW9Db25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgICAgLy8gQWRkIGdsb2JhbCByZXNvdXJjZSBhY2Nlc3MgLSBMYW1iZGFGdW5jdGlvbiBzZXRzIGVudiB2YXIgYXV0b21hdGljYWxseVxuICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsUmVzb3VyY2VBY2Nlc3Moe1xuICAgICAgICAgICAgdGFibGVzOiBbIHsgbmFtZTogdGFibGVOYW1lLCBhY2Nlc3M6IFsgJ3JlYWR3cml0ZScgXSB9IF0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XG4gICAgICAgIGlmIChoYXNTZWFyY2hJbmRleGluZykgZmVhdHVyZXMucHVzaCgnc2VhcmNoJyk7XG4gICAgICAgIGlmIChoYXNTdHJlYW1Db25maWcpIGZlYXR1cmVzLnB1c2goJ3N0cmVhbScpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSBPYnNlcnZhYmlsaXR5OiAke3RhYmxlTmFtZX0ke2ZlYXR1cmVzLmxlbmd0aCA/ICcgKCcgKyBmZWF0dXJlcy5qb2luKCcsICcpICsgJyknIDogJyd9YCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0dXAgQ2xvdWRXYXRjaCBpbmZyYXN0cnVjdHVyZSBmb3Igb2JzZXJ2YWJpbGl0eS5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHNldHVwT2JzZXJ2YWJpbGl0eUNsb3VkV2F0Y2goY2ZnOiBJT2JzZXJ2YWJpbGl0eUluZnJhQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGN3ID0gY2ZnLmNsb3Vkd2F0Y2ghO1xuICAgICAgICBjb25zdCBhcHBOYW1lID0gdGhpcy5mdzI0LmdldENvbmZpZygpLm5hbWUgfHwgJ2FwcCc7XG4gICAgICAgIGNvbnN0IGxvZ0dyb3VwTmFtZSA9IGN3LmxvZ0dyb3VwTmFtZSA/PyBgL29ic2VydmFiaWxpdHkvJHthcHBOYW1lfWA7XG5cbiAgICAgICAgLy8gVE9ETzogQ3JlYXRlIGN1c3RvbSBsb2cgZ3JvdXAgd2hlbiBuZWVkZWRcbiAgICAgICAgLy8gRm9yIG5vdywganVzdCBzZXQgZW52IHZhciBzbyBydW50aW1lIGNhbiB1c2UgaXRcbiAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGUoJ09CU0VSVkFCSUxJVFlfTE9HX0dST1VQJywgbG9nR3JvdXBOYW1lKTtcblxuICAgICAgICBpZiAoY3cucmV0ZW50aW9uRGF5cykge1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGUoJ09CU0VSVkFCSUxJVFlfTE9HX1JFVEVOVElPTl9EQVlTJywgU3RyaW5nKGN3LnJldGVudGlvbkRheXMpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSBPYnNlcnZhYmlsaXR5IENsb3VkV2F0Y2g6ICR7bG9nR3JvdXBOYW1lfWApO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFN0YXJ0IHRoZSBsb2NhbCBzaW11bGF0b3IgZm9yIGRldmVsb3BtZW50LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBzaW11bGF0ZShjb25maWc6IElTaW11bGF0b3JDb25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiU3RhcnRpbmcgSGlnaC1GaWRlbGl0eSBTaW11bGF0b3IgKGZ3MjQgZGV2KS4uLlwiKTtcblxuICAgICAgICBjb25zdCBjb29yZGluYXRvciA9IG5ldyBTaW11bGF0b3JDb29yZGluYXRvcihjb25maWcpO1xuXG4gICAgICAgIGNvbnN0IHN5bmMgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiU3luY2luZyB3aXRoIENESyBibHVlcHJpbnQuLi5cIik7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgLy8gMS4gUnVuIENESyBTeW50aFxuICAgICAgICAgICAgICAgIGNvbnN0IHsgc3Bhd25TeW5jIH0gPSByZXF1aXJlKCdub2RlOmNoaWxkX3Byb2Nlc3MnKTtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiUnVubmluZyAnY2RrIHN5bnRoJyB0byBnZW5lcmF0ZSBibHVlcHJpbnQuLi5cIik7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gc3Bhd25TeW5jKCducHgnLCBbJ2NkaycsICdzeW50aCddLCB7IFxuICAgICAgICAgICAgICAgICAgICBzdGRpbzogJ2luaGVyaXQnLFxuICAgICAgICAgICAgICAgICAgICBzaGVsbDogdHJ1ZVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChyZXN1bHQuc3RhdHVzICE9PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKFwi4p2MIENESyBTeW50aCBmYWlsZWQuIFNpbXVsYXRvciBjYW5ub3Qgc3RhcnQvc3luYyB3aXRob3V0IGEgdmFsaWQgYmx1ZXByaW50LlwiKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoXCJQbGVhc2UgZml4IHRoZSBlcnJvcnMgaW4geW91ciBDREsvSW5mcmFzdHJ1Y3R1cmUgY29kZSBhbmQgdGhlIHNpbXVsYXRvciB3aWxsIHJldHJ5IG9uIHRoZSBuZXh0IHNhdmUuXCIpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gMi4gU3luYyBDb29yZGluYXRvciB3aXRoIENESyBibHVlcHJpbnRcbiAgICAgICAgICAgICAgICBhd2FpdCBjb29yZGluYXRvci5zeW5jV2l0aENESygpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCLinIUgU2ltdWxhdG9yIHN5bmNlZCB3aXRoIGxhdGVzdCBDREsgYmx1ZXByaW50LlwiKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihcIuKdjCBFcnJvciBkdXJpbmcgQ0RLIHN5bmNocm9uaXphdGlvbjpcIiwgZXJyb3IubWVzc2FnZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoZXJyb3Iuc3RhY2spO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgc3luYygpO1xuXG4gICAgICAgIC8vIDMuIFN0YXJ0IFNpbXVsYXRvclxuICAgICAgICBhd2FpdCBjb29yZGluYXRvci5zdGFydCgpO1xuXG4gICAgICAgIC8vIDQuIFNldHVwIEhNUlxuICAgICAgICBpZiAoY29uZmlnLmhvdFJlbG9hZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgIGNvbnN0IHdhdGNoZXIgPSBuZXcgSE1SV2F0Y2hlcignLi9zcmMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkNoYW5nZSBkZXRlY3RlZCwgcmUtc3ludGhlc2l6aW5nLi4uXCIpO1xuICAgICAgICAgICAgICAgIGF3YWl0IHN5bmMoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgd2F0Y2hlci5zdGFydCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlNpbXVsYXRvciBpcyByZWFkeSFcIik7XG5cbiAgICAgICAgcmV0dXJuIGNvb3JkaW5hdG9yO1xuICAgIH1cblxufVxuIl19