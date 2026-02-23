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
        this.logger.info("Starting FW24 Simulator...");
        process.env.SIMULATION_MODE = 'true';
        const coordinator = new coordinator_1.SimulatorCoordinator(config);
        const discover = async () => {
            this.logger.info("Discovering resources...");
            try {
                // Clear previous construction state
                this.processedConstructs.clear();
                // Clear previous simulation state in Fw24
                this.fw24.getSimulatedLambdas().clear();
                this.fw24.setEnvironmentVariable('SIMULATED_API_ROUTES', []);
                this.fw24.setEnvironmentVariable('SIMULATED_QUEUES', []);
                // 1. Process Modules
                this.processModules();
                // 2. Build Constructs (this will populate simulated metadata in Fw24)
                await this.constructAllResources();
                // 3. Collect Metadata
                const lambdaConfigs = this.fw24.getSimulatedLambdas();
                const apiRoutes = this.fw24.getEnvironmentVariable('SIMULATED_API_ROUTES') || [];
                const sqsSubs = this.fw24.getEnvironmentVariable('SIMULATED_QUEUES') || [];
                coordinator.setLambdaConfigs(lambdaConfigs);
                coordinator.setApiRoutes(apiRoutes);
                coordinator.setSqsSubscriptions(sqsSubs);
            }
            catch (error) {
                this.logger.error("Error during resource discovery:", error);
            }
        };
        await discover();
        // 3. Start Simulator
        await coordinator.start();
        // 4. Setup HMR
        if (config.hotReload !== false) {
            const watcher = new hmr_watcher_1.HMRWatcher('./src', async () => {
                this.logger.info("Change detected, reloading...");
                await discover();
            });
            watcher.start();
        }
        this.logger.info("Simulator started successfully!");
        return coordinator;
    }
}
exports.Application = Application;
__decorate([
    (0, logging_1.LogDuration)()
], Application.prototype, "run", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsNkNBQXlDO0FBQ3pDLDJEQUF5RTtBQUN6RSxzQ0FBbUM7QUFJbkMsK0VBQXlFO0FBQ3pFLHVDQUErRDtBQUMvRCw2Q0FBaUU7QUFDakUsbUNBQWdDO0FBQ2hDLDZDQUF5QztBQUN6Qyx5Q0FBc0Q7QUFFdEQsaUVBQXVFO0FBRXZFLGlFQUE2RDtBQUU3RCxNQUFhLFdBQVc7SUFDWCxNQUFNLENBQVU7SUFDekIsU0FBUyxDQUFTO0lBRUYsSUFBSSxDQUFPO0lBQ1gsV0FBVyxDQUFvQjtJQUM5QixVQUFVLENBQTZCO0lBQ3ZDLE9BQU8sQ0FBMkI7SUFDbEMsbUJBQW1CLEdBQStCLElBQUksR0FBRyxFQUFFLENBQUM7SUFDNUQsK0JBQStCLEdBQVcsRUFBRSxDQUFDO0lBQ3RELG1DQUFtQyxHQUFHLENBQUMsQ0FBQztJQUMvQixtQkFBbUIsQ0FBd0I7SUFFNUQsWUFBWSxTQUE2QixFQUFFO1FBQ3ZDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLENBQUUsV0FBVyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxXQUFXLENBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUU1RixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO1FBRXhELElBQUksQ0FBQyxJQUFJLEdBQUcsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQy9CLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSx3Q0FBaUIsRUFBRSxDQUFDO1FBQzNDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRTVCLElBQUksTUFBTSxDQUFDLG9CQUFvQixFQUFFLENBQUM7WUFD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QUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQzVJLEVBQUUs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QU0sT0FBTyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLENBQUM7Z0JBRTNFLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsQ0FBQztnQkFDNUMsV0FBVyxDQUFDLFlBQVksQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFDcEMsV0FBVyxDQUFDLG1CQUFtQixDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQzdDLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNiLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLGtDQUFrQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ2pFLENBQUM7UUFDTCxDQUFDLENBQUE7UUFFRCxNQUFNLFFBQVEsRUFBRSxDQUFDO1FBRWpCLHFCQUFxQjtRQUNyQixNQUFNLFdBQVcsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUUxQixlQUFlO1FBQ2YsSUFBSSxNQUFNLENBQUMsU0FBUyxLQUFLLEtBQUssRUFBRSxDQUFDO1lBQzdCLE1BQU0sT0FBTyxHQUFHLElBQUksd0JBQVUsQ0FBQyxPQUFPLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQy9DLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLCtCQUErQixDQUFDLENBQUM7Z0JBQ2xELE1BQU0sUUFBUSxFQUFFLENBQUM7WUFDckIsQ0FBQyxDQUFDLENBQUM7WUFDSCxPQUFPLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDcEIsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGlDQUFpQyxDQUFDLENBQUM7UUFFcEQsT0FBTyxXQUFXLENBQUM7SUFDdkIsQ0FBQztDQUVKO0FBL2FELGtDQSthQztBQXJWZ0I7SUFEWixJQUFBLHFCQUFXLEdBQUU7c0NBNkRiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQXBwLCBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgQXR0cmlidXRlVHlwZSwgU3RyZWFtVmlld1R5cGUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBJQXBwbGljYXRpb25Db25maWcsIElPYnNlcnZhYmlsaXR5Q29uZmlnLCBJT2JzZXJ2YWJpbGl0eUluZnJhQ29uZmlnIH0gZnJvbSBcIi4vaW50ZXJmYWNlcy9jb25maWdcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QgfSBmcm9tIFwiLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgSUZ3MjRNb2R1bGUgfSBmcm9tIFwiLi9jb3JlL3J1bnRpbWUvbW9kdWxlXCI7XG5pbXBvcnQgeyBFbnRpdHlVSUNvbmZpZ0dlbiB9IGZyb20gXCIuL3VpLWNvbmZpZy1nZW4vZW50aXR5LXVpLWNvbmZpZy5nZW5cIjtcbmltcG9ydCB7IElMb2dnZXIsIExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBEeW5hbW9EQkNvbnN0cnVjdCwgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyBUaW1lciB9IGZyb20gXCIuL3V0aWxzXCI7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnbm9kZTpjcnlwdG8nO1xuaW1wb3J0IHsgam9pbiBhcyBwYXRoSm9pbiwgcmVzb2x2ZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBJU2ltdWxhdG9yQ29uZmlnIH0gZnJvbSBcIi4vdGVzdGluZy9zaW11bGF0b3IvaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgU2ltdWxhdG9yQ29vcmRpbmF0b3IgfSBmcm9tIFwiLi90ZXN0aW5nL3NpbXVsYXRvci9jb29yZGluYXRvclwiO1xuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEhNUldhdGNoZXIgfSBmcm9tIFwiLi90ZXN0aW5nL3NpbXVsYXRvci9obXItd2F0Y2hlclwiO1xuXG5leHBvcnQgY2xhc3MgQXBwbGljYXRpb24ge1xuICAgIHJlYWRvbmx5IGxvZ2dlcjogSUxvZ2dlcjtcbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIHB1YmxpYyByZWFkb25seSBmdzI0OiBGdzI0O1xuICAgIHB1YmxpYyByZWFkb25seSB1aUNvbmZpZ0dlbjogRW50aXR5VUlDb25maWdHZW47XG4gICAgcHJpdmF0ZSByZWFkb25seSBjb25zdHJ1Y3RzOiBNYXA8c3RyaW5nLCBGVzI0Q29uc3RydWN0PjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IG1vZHVsZXM6IE1hcDxzdHJpbmcsIElGdzI0TW9kdWxlPjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHByb2Nlc3NlZENvbnN0cnVjdHM6IE1hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+ID0gbmV3IE1hcCgpO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVzb3VyY2VDb25zdHJ1Y3RNYXhDb25jdXJyZW5jeTogbnVtYmVyID0gMTA7XG4gICAgcHJpdmF0ZSByZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSA9IDA7XG4gICAgcHJpdmF0ZSByZWFkb25seSBvYnNlcnZhYmlsaXR5Q29uZmlnPzogSU9ic2VydmFiaWxpdHlDb25maWc7XG5cbiAgICBjb25zdHJ1Y3Rvcihjb25maWc6IElBcHBsaWNhdGlvbkNvbmZpZyA9IHt9KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyID0gY3JlYXRlTG9nZ2VyKFsgQXBwbGljYXRpb24ubmFtZSwgY29uZmlnLm5hbWUsIGNvbmZpZy5lbnZpcm9ubWVudCBdLmpvaW4oJy0nKSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkluaXRpYWxpemluZyBmdzI0IGluZnJhc3RydWN0dXJlLi4uXCIpO1xuXG4gICAgICAgIHRoaXMuZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICAgICAgdGhpcy51aUNvbmZpZ0dlbiA9IG5ldyBFbnRpdHlVSUNvbmZpZ0dlbigpO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uZmlnKGNvbmZpZyk7XG5cbiAgICAgICAgaWYgKGNvbmZpZy5lbnZpcm9ubWVudFZhcmlhYmxlcykge1xuICAgICAgICAgICAgT2JqZWN0LmVudHJpZXMoY29uZmlnLmVudmlyb25tZW50VmFyaWFibGVzKS5mb3JFYWNoKChbIGtleSwgdmFsdWUgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjb25maWcuZ2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMpIHtcbiAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKGNvbmZpZy5nbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcykuZm9yRWFjaCgoWyBrZXksIHZhbHVlIF0pID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0R2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICAvLyBBcHBseSBnbG9iYWwgcG9saWNpZXMgZnJvbSBjb25maWdcbiAgICAgICAgaWYgKGNvbmZpZy5nbG9iYWxQb2xpY2llcykge1xuICAgICAgICAgICAgY29uZmlnLmdsb2JhbFBvbGljaWVzLmZvckVhY2gocG9saWN5ID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsUG9saWN5KHBvbGljeSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFwcGx5IGdsb2JhbCByZXNvdXJjZSBhY2Nlc3MgZnJvbSBjb25maWdcbiAgICAgICAgaWYgKGNvbmZpZy5nbG9iYWxSZXNvdXJjZUFjY2Vzcykge1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbFJlc291cmNlQWNjZXNzKGNvbmZpZy5nbG9iYWxSZXNvdXJjZUFjY2Vzcyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBlbnN1cmUgdGhlcmUncyBhIGxvZy1sZXZlbCBzZXQgaW4gdGhlIGZ3MjQgc2NvcGUgc28gdGhhdCB0aGUgY29uc3RydWN0cyBjYW4gYXNrIGZvciB0aGlzIHZhbHVlXG4gICAgICAgIC8vIHRoaXMncyBvbmx5IHRoZSBnbG9iYWwgdmFsdWUsIGFuZCBjYW4gYmUgb3ZlcnJpZGRlbiBieSBlYWNoIGxhbWJkYSBmdW5jdGlvbi5cbiAgICAgICAgaWYgKCF0aGlzLmZ3MjQuaGFzRW52aXJvbm1lbnRWYXJpYWJsZSgnTE9HX0xFVkVMJykpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdMT0dfTEVWRUwnLCBwcm9jZXNzLmVudi5MT0dfTEVWRUwgfHwgJ0lORk8nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFN0b3JlIG9ic2VydmFiaWxpdHkgY29uZmlnIGZvciBwcm9jZXNzaW5nIGluIHJ1bigpXG4gICAgICAgIGlmIChjb25maWcub2JzZXJ2YWJpbGl0eSkge1xuICAgICAgICAgICAgdGhpcy5vYnNlcnZhYmlsaXR5Q29uZmlnID0gY29uZmlnLm9ic2VydmFiaWxpdHk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmNvbnN0cnVjdHMgPSBuZXcgTWFwKCk7XG4gICAgICAgIHRoaXMubW9kdWxlcyA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBpbml0aWFsaXplIHRoZSBtYWluIHN0YWNrXG4gICAgICAgIGNvbnN0IGFwcCA9IG5ldyBBcHAoKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldEFwcChhcHApO1xuXG4gICAgfVxuXG4gICAgcHVibGljIHVzZShjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QpOiB0aGlzIHtcbiAgICAgICAgdGhpcy5yZWdpc3RlckNvbnN0cnVjdChjb25zdHJ1Y3QpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBwdWJsaWMgdXNlTW9kdWxlKG1vZHVsZTogSUZ3MjRNb2R1bGUpOiB0aGlzIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDYWxsZWQgVXNlTW9kdWxlIHdpdGggbW9kdWxlOiBcIiwgeyBtb2R1bGVOYW1lOiBtb2R1bGUuZ2V0TmFtZSgpIH0pO1xuXG4gICAgICAgIGlmICh0aGlzLm1vZHVsZXMuaGFzKG1vZHVsZS5nZXROYW1lKCkpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZHVsZSB3aXRoIG5hbWUgJHttb2R1bGUuZ2V0TmFtZSgpfSBpcyBhbHJlYWR5IHJlZ2lzdGVyZWQuYCk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLm1vZHVsZXMuc2V0KG1vZHVsZS5nZXROYW1lKCksIG1vZHVsZSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBbIGNvbnN0cnVjdE5hbWUsIGNvbnN0cnVjdCBdIG9mIG1vZHVsZS5nZXRDb25zdHJ1Y3RzKCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJVc2VNb2R1bGU6IFJlZ2lzdGVyaW5nIGNvbnN0cnVjdDogXCIsIGNvbnN0cnVjdE5hbWUsIG1vZHVsZS5nZXREZXBlbmRlbmNpZXMoKSwgY29uc3RydWN0LmRlcGVuZGVuY2llcyk7XG4gICAgICAgICAgICBjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzID0gbW9kdWxlLmdldERlcGVuZGVuY2llcygpO1xuICAgICAgICAgICAgdGhpcy5yZWdpc3RlckNvbnN0cnVjdChjb25zdHJ1Y3QsIGNvbnN0cnVjdE5hbWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgcnVuKCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiUnVubmluZyBmdzI0IGluZnJhc3RydWN0dXJlLi4uXCIpO1xuXG4gICAgICAgIC8vICoqKiBvcmRlciBpcyBpbXBvcnRhbnQgaGVyZSwgbW9kdWxlcyBuZWVkIHRvIGJlIHByb2Nlc3NlZCBmaXJzdCwgYmVmb3JlIGNvbnN0cnVjdHMgKioqXG4gICAgICAgIHRoaXMucHJvY2Vzc01vZHVsZXMoKTtcblxuICAgICAgICBjb25zdCBkaXNhYmxlVUlDb25maWdHZW4gPSBGdzI0LmdldEluc3RhbmNlKCkuZ2V0Q29uZmlnKCkuZGlzYWJsZVVJQ29uZmlnR2VuO1xuXG4gICAgICAgIGlmICghZGlzYWJsZVVJQ29uZmlnR2VuKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnVpQ29uZmlnR2VuLnJ1bigpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gY29uZmlndXJlIGEgYnVpbGQgY29tbWFuZCBsaWtlIGluIHBhY2thZ2UuanNvbiB0byBvbmx5IGdlbmVyYXRlIHRoZSB1aSBjb25maWdcbiAgICAgICAgLy8gXCJ1aTpnZW5cIjogXCJVSV9HRU5fT05MWT10cnVlIGVudi1jbWQgLWYgLmVudi5sb2NhbCB0cy1ub2RlIHNyYy9pbmRleC50c1wiXG4gICAgICAgIC8vIHRoaXMgaXMgdXNlZnVsIGZvciBnZW5lcmF0aW5nIHRoZSB1aSBjb25maWcgZHVyaW5nIGRldmVsb3BtZW50XG4gICAgICAgIGlmIChwcm9jZXNzLmVudi5VSV9HRU5fT05MWSA9PT0gJ3RydWUnKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdVSSBjb25maWcgZ2VuZXJhdGlvbiBjb21wbGV0ZS4gRXhpdGluZy4nKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBkZWZhdWx0IGZ3MjQgcnVudGltZSBsYXllciAoT05MWSBydW50aW1lIGNvZGUsIG5vdCBpbmZyYXN0cnVjdHVyZSlcbiAgICAgICAgLy8gVGhpcyBsYXllciBpcyBhdXRvbWF0aWNhbGx5IGF0dGFjaGVkIHRvIGFsbCBMYW1iZGEgZnVuY3Rpb25zXG4gICAgICAgIC8vIEl0J3MgTk9UIGFuIGVudHJ5IHBhY2thZ2UgLSBpdCdzIGp1c3QgYXZhaWxhYmxlIGZvciBpbXBvcnRzXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJCdWlsZGluZyBmdzI0IHJ1bnRpbWUgbGF5ZXIuLi5cIik7XG4gICAgICAgIGNvbnN0IGZ3MjRMYXllciA9IG5ldyBMYXllckNvbnN0cnVjdChbIHtcbiAgICAgICAgICAgIG1vZGU6ICdCVUlMRF9BTkRfUEFDS0FHRScsXG4gICAgICAgICAgICAvLyBCdW5kbGUgdGhlIGZ3MjQgcnVudGltZSBzb3VyY2UgKGhhcyBpbXBvcnRzLCBuZWVkcyBidW5kbGluZyB3aXRoIGVzYnVpbGQpXG4gICAgICAgICAgICBzb3VyY2VQYXRoOiAnLi9ub2RlX21vZHVsZXMvQHRlbjI0Z3JvdXAvZncyNC9kaXN0L3BhY2thZ2UvbGF5ZXIvZncyNC5qcycsXG4gICAgICAgICAgICBwYWNrYWdlUGF0aDogJ0B0ZW4yNGdyb3VwL2Z3MjQnLFxuICAgICAgICAgICAgcHJpb3JpdHk6IDAsXG4gICAgICAgICAgICAvLyBPdXRwdXQgdG8gYXBwbGljYXRpb24ncyBkaXN0L2xheWVycyBkaXJlY3RvcnksIG5vdCBmcmFtZXdvcmsncyBkaXJlY3RvcnlcbiAgICAgICAgICAgIGRpc3REaXJlY3Rvcnk6IHBhdGhKb2luKHByb2Nlc3MuY3dkKCksICdkaXN0L2xheWVycycpLFxuICAgICAgICAgICAgYnVpbGRPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgc291cmNlbWFwOiB0cnVlLFxuICAgICAgICAgICAgICAgIGV4dGVybmFsOiBbICdAYXdzLXNkaycsICdAc21pdGh5JyBdIC8vIEFXUyBTREsgaXMgTk9UIHByb3ZpZGVkIGJ5IExhbWJkYSBydW50aW1lXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaXNFbnRyeVBhY2thZ2U6IGZhbHNlLFxuICAgICAgICB9IF0pO1xuICAgICAgICBhd2FpdCBmdzI0TGF5ZXIuY29uc3RydWN0KCk7XG5cbiAgICAgICAgLy8gQnVpbGQgdXNlci1kZWZpbmVkIGxheWVycyBCRUZPUkUgb2JzZXJ2YWJpbGl0eSBzZXR1cFxuICAgICAgICAvLyBUaGlzIGVuc3VyZXMgZW50cnkgcGFja2FnZXMgYXJlIHJlZ2lzdGVyZWQgZm9yIGFueSBsYW1iZGFzIGNyZWF0ZWQgYnkgb2JzZXJ2YWJpbGl0eSBEeW5hbW9EQlxuICAgICAgICBhd2FpdCB0aGlzLmJ1aWxkVXNlckxheWVycygpO1xuXG4gICAgICAgIC8vIFNldHVwIG9ic2VydmFiaWxpdHkgaW5mcmFzdHJ1Y3R1cmUgQUZURVIgdXNlciBsYXllcnMgYXJlIGJ1aWx0XG4gICAgICAgIC8vIFRoaXMgZW5zdXJlcyBhbnkgbGFtYmRhcyBjcmVhdGVkIGJ5IG9ic2VydmFiaWxpdHkgaGF2ZSBhY2Nlc3MgdG8gZW50cnkgcGFja2FnZXNcbiAgICAgICAgaWYgKHRoaXMub2JzZXJ2YWJpbGl0eUNvbmZpZykge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5zZXR1cE9ic2VydmFiaWxpdHkodGhpcy5vYnNlcnZhYmlsaXR5Q29uZmlnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRvdGFsQ29uc3RydWN0cyA9IHRoaXMuY29uc3RydWN0cy5zaXplO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfWApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDwn5qAIEJ1aWxkaW5nICR7dG90YWxDb25zdHJ1Y3RzfSBjb25zdHJ1Y3QocykuLi5gKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgJHsnPScucmVwZWF0KDYwKX1cXG5gKTtcblxuICAgICAgICBhd2FpdCB0aGlzLmNvbnN0cnVjdEFsbFJlc291cmNlcygpXG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgJHsnPScucmVwZWF0KDYwKX1gKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg4pyFIEFsbCBjb25zdHJ1Y3RzIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHlgKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgJHsnPScucmVwZWF0KDYwKX1cXG5gKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBCdWlsZCB1c2VyLWRlZmluZWQgbGF5ZXIgY29uc3RydWN0cyBiZWZvcmUgb3RoZXIgY29uc3RydWN0cy5cbiAgICAgKiBUaGlzIGVuc3VyZXMgZW50cnkgcGFja2FnZXMgYXJlIHJlZ2lzdGVyZWQgYmVmb3JlIGFueSBsYW1iZGFzIGFyZSBjcmVhdGVkLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgYnVpbGRVc2VyTGF5ZXJzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCBsYXllckNvbnN0cnVjdHMgPSBBcnJheS5mcm9tKHRoaXMuY29uc3RydWN0cy5lbnRyaWVzKCkpXG4gICAgICAgICAgICAuZmlsdGVyKChbIF8sIGNvbnN0cnVjdCBdKSA9PiBjb25zdHJ1Y3QubmFtZSA9PT0gJ0xheWVyQ29uc3RydWN0JylcbiAgICAgICAgICAgIC5tYXAoKFsgbmFtZSBdKSA9PiBuYW1lKTtcblxuICAgICAgICBpZiAobGF5ZXJDb25zdHJ1Y3RzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQnVpbGRpbmcgJHtsYXllckNvbnN0cnVjdHMubGVuZ3RofSB1c2VyIGxheWVyKHMpIGZpcnN0Li4uYCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBjb25zdHJ1Y3ROYW1lIG9mIGxheWVyQ29uc3RydWN0cykge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb25zdHJ1Y3RSZXNvdXJjZXMoY29uc3RydWN0TmFtZSk7XG4gICAgICAgIH1cbiAgICB9XG5cblxuICAgIHByaXZhdGUgcmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0OiBGVzI0Q29uc3RydWN0LCBuYW1lPzogc3RyaW5nKSB7XG4gICAgICAgIGxldCBjb25zdHJ1Y3ROYW1lID0gbmFtZSB8fCBjb25zdHJ1Y3QubmFtZTtcbiAgICAgICAgaWYgKHRoaXMuY29uc3RydWN0cy5oYXMoY29uc3RydWN0TmFtZSkpIHtcbiAgICAgICAgICAgIC8vIGhhbmRsZSBtdWx0aXBsZSBjb25zdHJ1Y3RzIG9mIHNhbWUgdHlwZVxuICAgICAgICAgICAgY29uc3QgbmV3Q29uc3RydWN0TmFtZSA9IGNvbnN0cnVjdE5hbWUuY29uY2F0KCctJywgcmFuZG9tVVVJRCgpKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbnN0cnVjdCB3aXRoIG5hbWUgJHtjb25zdHJ1Y3ROYW1lfSBpcyBhbHJlYWR5IHJlZ2lzdGVyZWQsIHJlbmFtaW5nIHRvICR7bmV3Q29uc3RydWN0TmFtZX1gKTtcbiAgICAgICAgICAgIGNvbnN0cnVjdE5hbWUgPSBuZXdDb25zdHJ1Y3ROYW1lO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY29uc3RydWN0cy5zZXQoY29uc3RydWN0TmFtZSwgY29uc3RydWN0KTtcbiAgICAgICAgdGhpcy5mdzI0LmFkZENvbnN0cnVjdChjb25zdHJ1Y3QpO1xuICAgIH1cblxuICAgIHByaXZhdGUgcHJvY2Vzc01vZHVsZXMoKSB7XG4gICAgICAgIGZvciAoY29uc3QgWyBtb2R1bGVOYW1lLCBtb2R1bGUgXSBvZiB0aGlzLm1vZHVsZXMpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5hZGRNb2R1bGUobW9kdWxlTmFtZSwgbW9kdWxlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgY29uc3RydWN0QWxsUmVzb3VyY2VzKCkge1xuICAgICAgICBjb25zdCBhbGxDb25zdHJ1Y3RzID0gQXJyYXkuZnJvbSh0aGlzLmNvbnN0cnVjdHMua2V5cygpKS5tYXAoY29uc3RydWN0TmFtZSA9PiB0aGlzLmNvbnN0cnVjdFJlc291cmNlcyhjb25zdHJ1Y3ROYW1lKSk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChhbGxDb25zdHJ1Y3RzKTtcbiAgICB9XG5cbiAgICBhc3luYyBjb25zdHJ1Y3RSZXNvdXJjZXMoY29uc3RydWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIENoZWNrIGlmIGFscmVhZHkgcHJvY2Vzc2VkIG9yIGluIHByb2dyZXNzIC0gcHJldmVudCBkdXBsaWNhdGUgYnVpbGRzXG4gICAgICAgIGlmICh0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGNvbnN0cnVjdE5hbWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmdldChjb25zdHJ1Y3ROYW1lKSE7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb25zdHJ1Y3QgPSB0aGlzLmNvbnN0cnVjdHMuZ2V0KGNvbnN0cnVjdE5hbWUpO1xuICAgICAgICBpZiAoIWNvbnN0cnVjdCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb25zdHJ1Y3QgJHtjb25zdHJ1Y3ROYW1lfSBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHdoaWxlICh0aGlzLnJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5ID49IHRoaXMucmVzb3VyY2VDb25zdHJ1Y3RNYXhDb25jdXJyZW5jeSkge1xuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDEwMCkpOyAvLyBUaHJvdHRsZSBpZiBjb25jdXJyZW5jeSBsaW1pdCBpcyByZWFjaGVkXG4gICAgICAgIH1cblxuICAgICAgICAvLyBPbmx5IGxvZyBpZiB0aGVyZSBhcmUgYWN0dWFsIGRlcGVuZGVuY2llc1xuICAgICAgICBpZiAoY29uc3RydWN0LmRlcGVuZGVuY2llcyAmJiBjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGDij7MgJHtjb25zdHJ1Y3ROYW1lfTogV2FpdGluZyBmb3IgZGVwZW5kZW5jaWVzOiAke2NvbnN0cnVjdC5kZXBlbmRlbmNpZXMuam9pbignLCAnKX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFdhaXQgZm9yIGRlcGVuZGVuY2llcyB0byByZXNvbHZlXG4gICAgICAgIGF3YWl0IHRoaXMud2FpdEZvckRlcGVuZGVuY2llcyhjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzLCBjb25zdHJ1Y3ROYW1lKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDwn5SoIEJ1aWxkaW5nICR7Y29uc3RydWN0TmFtZX0uLi5gKTtcblxuICAgICAgICB0aGlzLnJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5Kys7XG4gICAgICAgIGNvbnN0IHRpbWVyID0gVGltZXIuc3RhcnQoKTtcbiAgICAgICAgY29uc3QgY29uc3RydWN0Q29tcGxldGlvblByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCBjb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg4pyFICR7Y29uc3RydWN0TmFtZX0gY29tcGxldGVkIGluICR7dGltZXIuZWxhcHNlZFNlY29uZHMoKX1gKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYOKdjCAke2NvbnN0cnVjdE5hbWV9IGZhaWxlZDpgLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7IC8vIFJlLXRocm93IHRvIGVuc3VyZSBkZXBsb3ltZW50IGZhaWxzXG4gICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgIHRoaXMucmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3ktLTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkoKTtcblxuICAgICAgICB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuc2V0KGNvbnN0cnVjdE5hbWUsIGNvbnN0cnVjdENvbXBsZXRpb25Qcm9taXNlKTtcbiAgICAgICAgcmV0dXJuIGNvbnN0cnVjdENvbXBsZXRpb25Qcm9taXNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgd2FpdEZvckRlcGVuZGVuY2llcyhkZXBlbmRlbmNpZXM6IHN0cmluZ1tdLCBjb25zdHJ1Y3ROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKCFkZXBlbmRlbmNpZXMgfHwgZGVwZW5kZW5jaWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBkZXBlbmRlbmNpZXMubWFwKGRlcGVuZGVuY3kgPT4ge1xuICAgICAgICAgICAgLy8gaWYgZGVwZW5kZW5jeSBjb25zdHJ1Y3QgZG9lcyBub3QgZXhpc3RzIGluIHRoZSBjb25zdHJ1Y3QgbGlzdCwgbWFyayBpdCBhcyBwcm9jZXNzZWRcbiAgICAgICAgICAgIGlmICghdGhpcy5jb25zdHJ1Y3RzLmhhcyhkZXBlbmRlbmN5KSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGAke2NvbnN0cnVjdE5hbWV9OiBEZXBlbmRlbmN5ICR7ZGVwZW5kZW5jeX0gbm90IHJlZ2lzdGVyZWQgKG9wdGlvbmFsIGRlcGVuZGVuY3kpYCk7XG4gICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLnNldChkZXBlbmRlbmN5LCBQcm9taXNlLnJlc29sdmUoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIXRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICAvLyBJZiBkZXBlbmRlbmN5IG5vdCBzY2hlZHVsZWQgeWV0LCBsaXN0ZW4gZm9yIGl0cyBhZGRpdGlvblxuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGVhckludGVydmFsKGludGVydmFsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuZ2V0KGRlcGVuZGVuY3kpIS50aGVuKHJlc29sdmUsIHJlamVjdCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sIDEwMCk7IC8vIENoZWNrIGV2ZXJ5IDEwMG1zXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmdldChkZXBlbmRlbmN5KSE7XG4gICAgICAgIH0pO1xuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChwcm9taXNlcyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0dXAgb2JzZXJ2YWJpbGl0eSBpbmZyYXN0cnVjdHVyZS5cbiAgICAgKiAtIGB0cnVlYCA9IER5bmFtb0RCIHdpdGggZGVmYXVsdHNcbiAgICAgKiAtIGB7IGR5bmFtb2RiOiB7Li4ufSB9YCA9IER5bmFtb0RCIHRhYmxlXG4gICAgICogLSBgeyBjbG91ZHdhdGNoOiB7Li4ufSB9YCA9IEN1c3RvbSBDbG91ZFdhdGNoIGxvZyBncm91cCAobm8gRHluYW1vREIpXG4gICAgICogLSBgeyBkeW5hbW9kYjogey4uLn0sIGNsb3Vkd2F0Y2g6IHsuLi59IH1gID0gQm90aFxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgc2V0dXBPYnNlcnZhYmlsaXR5KGNvbmZpZzogdHJ1ZSB8IElPYnNlcnZhYmlsaXR5SW5mcmFDb25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgLy8gdHJ1ZSA9IHNob3J0aGFuZCBmb3IgeyBkeW5hbW9kYjoge30gfVxuICAgICAgICBjb25zdCBjZmc6IElPYnNlcnZhYmlsaXR5SW5mcmFDb25maWcgPSBjb25maWcgPT09IHRydWUgPyB7IGR5bmFtb2RiOiB7fSB9IDogY29uZmlnO1xuXG4gICAgICAgIC8vIFNldHVwIENsb3VkV2F0Y2ggaWYgY29uZmlndXJlZFxuICAgICAgICBpZiAoY2ZnLmNsb3Vkd2F0Y2g/LmVuYWJsZWQgIT09IGZhbHNlICYmIGNmZy5jbG91ZHdhdGNoKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnNldHVwT2JzZXJ2YWJpbGl0eUNsb3VkV2F0Y2goY2ZnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNldHVwIER5bmFtb0RCIGlmIGNvbmZpZ3VyZWRcbiAgICAgICAgaWYgKGNmZy5keW5hbW9kYj8uZW5hYmxlZCAhPT0gZmFsc2UgJiYgY2ZnLmR5bmFtb2RiKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnNldHVwT2JzZXJ2YWJpbGl0eUR5bmFtb0RCKGNmZyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBMb2cgaWYgbmVpdGhlciBiYWNrZW5kIGlzIGNvbmZpZ3VyZWRcbiAgICAgICAgaWYgKCFjZmcuZHluYW1vZGIgJiYgIWNmZy5jbG91ZHdhdGNoKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCfimqDvuI8gT2JzZXJ2YWJpbGl0eSBlbmFibGVkIGJ1dCBubyBiYWNrZW5kcyBjb25maWd1cmVkJyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXR1cCBEeW5hbW9EQiBpbmZyYXN0cnVjdHVyZSBmb3Igb2JzZXJ2YWJpbGl0eS5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHNldHVwT2JzZXJ2YWJpbGl0eUR5bmFtb0RCKGNmZzogSU9ic2VydmFiaWxpdHlJbmZyYUNvbmZpZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCBkYiA9IGNmZy5keW5hbW9kYiE7XG4gICAgICAgIC8vIFRhYmxlIG5hbWU6IHVzZSBkYi5uYW1lIGlmIHByb3ZpZGVkLCBvdGhlcndpc2UgJ29ic2VydmFiaWxpdHlsb2dzJ1xuICAgICAgICAvLyBObyBhcHBOYW1lIHByZWZpeCAtIGtlZXBzIHRhYmxlS2V5IHNpbXBsZSBhbmQgY29udmVudGlvbi1iYXNlZFxuICAgICAgICBjb25zdCB0YWJsZU5hbWUgPSBkYi5uYW1lID8/ICdvYnNlcnZhYmlsaXR5bG9ncyc7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgc3RyZWFtIG5lZWRlZFxuICAgICAgICBjb25zdCBoYXNTZWFyY2hJbmRleGluZyA9IGRiLnNlYXJjaEluZGV4aW5nPy5zb21lKChzOiB7IGVuYWJsZWQ/OiBib29sZWFuIH0pID0+IHMuZW5hYmxlZCk7XG4gICAgICAgIGNvbnN0IGhhc1N0cmVhbUNvbmZpZyA9IGRiLnN0cmVhbT8uZW5hYmxlZDtcbiAgICAgICAgY29uc3QgbmVlZHNTdHJlYW0gPSBoYXNTZWFyY2hJbmRleGluZyB8fCBoYXNTdHJlYW1Db25maWc7XG5cbiAgICAgICAgLy8gRGVmYXVsdCB0YWJsZSBwcm9wcyAoNiBHU0lzKVxuICAgICAgICBjb25zdCBkZWZhdWx0UHJvcHMgPSB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3BrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3NrJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIHRpbWVUb0xpdmVBdHRyaWJ1dGU6ICd0dGwnLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBuZWVkc1N0cmVhbSA/IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFUyA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIGdsb2JhbFNlY29uZGFyeUluZGV4ZXM6IFtcbiAgICAgICAgICAgICAgICB7IGluZGV4TmFtZTogJ2dzaTEnLCBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2dzaTFwaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIHNvcnRLZXk6IHsgbmFtZTogJ2dzaTFzaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0gfSxcbiAgICAgICAgICAgICAgICB7IGluZGV4TmFtZTogJ2dzaTInLCBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2dzaTJwaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIHNvcnRLZXk6IHsgbmFtZTogJ2dzaTJzaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0gfSxcbiAgICAgICAgICAgICAgICB7IGluZGV4TmFtZTogJ2dzaTMnLCBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2dzaTNwaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIHNvcnRLZXk6IHsgbmFtZTogJ2dzaTNzaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0gfSxcbiAgICAgICAgICAgICAgICB7IGluZGV4TmFtZTogJ2dzaTQnLCBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2dzaTRwaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIHNvcnRLZXk6IHsgbmFtZTogJ2dzaTRzaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0gfSxcbiAgICAgICAgICAgICAgICB7IGluZGV4TmFtZTogJ2dzaTUnLCBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2dzaTVwaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIHNvcnRLZXk6IHsgbmFtZTogJ2dzaTVzaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0gfSxcbiAgICAgICAgICAgICAgICB7IGluZGV4TmFtZTogJ2dzaTYnLCBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2dzaTZwaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIHNvcnRLZXk6IHsgbmFtZTogJ2dzaTZzaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0gfSxcbiAgICAgICAgICAgICAgICB7IGluZGV4TmFtZTogJ2dzaTcnLCBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2dzaTdwaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIHNvcnRLZXk6IHsgbmFtZTogJ2dzaTdzaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0gfSxcbiAgICAgICAgICAgICAgICB7IGluZGV4TmFtZTogJ2dzaTgnLCBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2dzaThwaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIHNvcnRLZXk6IHsgbmFtZTogJ2dzaThzaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0gfSxcbiAgICAgICAgICAgICAgICB7IGluZGV4TmFtZTogJ2dzaTknLCBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2dzaTlwaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIHNvcnRLZXk6IHsgbmFtZTogJ2dzaTlzaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0gfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAuLi5kYi5wcm9wcyxcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBkeW5hbW9Db25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3Qoe1xuICAgICAgICAgICAgc3RhY2tOYW1lOiBjZmcuc3RhY2tOYW1lID8/ICdwZXJzaXN0ZW50JyxcbiAgICAgICAgICAgIHBhcmVudFN0YWNrTmFtZTogY2ZnLnBhcmVudFN0YWNrTmFtZSxcbiAgICAgICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgICAgICAgbmFtZTogdGFibGVOYW1lLFxuICAgICAgICAgICAgICAgIHByb3BzOiBkZWZhdWx0UHJvcHMsXG4gICAgICAgICAgICAgICAgc3RyZWFtOiBkYi5zdHJlYW0sXG4gICAgICAgICAgICAgICAgc2VhcmNoSW5kZXhpbmc6IGRiLnNlYXJjaEluZGV4aW5nLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZHluYW1vQ29uc3RydWN0Lm5hbWUgPSAnb2JzZXJ2YWJpbGl0eS1keW5hbW9kYic7XG4gICAgICAgIGF3YWl0IGR5bmFtb0NvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgICAvLyBBZGQgZ2xvYmFsIHJlc291cmNlIGFjY2VzcyAtIExhbWJkYUZ1bmN0aW9uIHNldHMgZW52IHZhciBhdXRvbWF0aWNhbGx5XG4gICAgICAgIHRoaXMuZncyNC5hZGRHbG9iYWxSZXNvdXJjZUFjY2Vzcyh7XG4gICAgICAgICAgICB0YWJsZXM6IFsgeyBuYW1lOiB0YWJsZU5hbWUsIGFjY2VzczogWyAncmVhZHdyaXRlJyBdIH0gXSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBbXTtcbiAgICAgICAgaWYgKGhhc1NlYXJjaEluZGV4aW5nKSBmZWF0dXJlcy5wdXNoKCdzZWFyY2gnKTtcbiAgICAgICAgaWYgKGhhc1N0cmVhbUNvbmZpZykgZmVhdHVyZXMucHVzaCgnc3RyZWFtJyk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg4pyFIE9ic2VydmFiaWxpdHk6ICR7dGFibGVOYW1lfSR7ZmVhdHVyZXMubGVuZ3RoID8gJyAoJyArIGZlYXR1cmVzLmpvaW4oJywgJykgKyAnKScgOiAnJ31gKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXR1cCBDbG91ZFdhdGNoIGluZnJhc3RydWN0dXJlIGZvciBvYnNlcnZhYmlsaXR5LlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgc2V0dXBPYnNlcnZhYmlsaXR5Q2xvdWRXYXRjaChjZmc6IElPYnNlcnZhYmlsaXR5SW5mcmFDb25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgY3cgPSBjZmcuY2xvdWR3YXRjaCE7XG4gICAgICAgIGNvbnN0IGFwcE5hbWUgPSB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkubmFtZSB8fCAnYXBwJztcbiAgICAgICAgY29uc3QgbG9nR3JvdXBOYW1lID0gY3cubG9nR3JvdXBOYW1lID8/IGAvb2JzZXJ2YWJpbGl0eS8ke2FwcE5hbWV9YDtcblxuICAgICAgICAvLyBUT0RPOiBDcmVhdGUgY3VzdG9tIGxvZyBncm91cCB3aGVuIG5lZWRlZFxuICAgICAgICAvLyBGb3Igbm93LCBqdXN0IHNldCBlbnYgdmFyIHNvIHJ1bnRpbWUgY2FuIHVzZSBpdFxuICAgICAgICB0aGlzLmZ3MjQuc2V0R2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZSgnT0JTRVJWQUJJTElUWV9MT0dfR1JPVVAnLCBsb2dHcm91cE5hbWUpO1xuXG4gICAgICAgIGlmIChjdy5yZXRlbnRpb25EYXlzKSB7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0R2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZSgnT0JTRVJWQUJJTElUWV9MT0dfUkVURU5USU9OX0RBWVMnLCBTdHJpbmcoY3cucmV0ZW50aW9uRGF5cykpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg4pyFIE9ic2VydmFiaWxpdHkgQ2xvdWRXYXRjaDogJHtsb2dHcm91cE5hbWV9YCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU3RhcnQgdGhlIGxvY2FsIHNpbXVsYXRvciBmb3IgZGV2ZWxvcG1lbnQuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIHNpbXVsYXRlKGNvbmZpZzogSVNpbXVsYXRvckNvbmZpZyA9IHt9KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJTdGFydGluZyBGVzI0IFNpbXVsYXRvci4uLlwiKTtcbiAgICAgICAgcHJvY2Vzcy5lbnYuU0lNVUxBVElPTl9NT0RFID0gJ3RydWUnO1xuXG4gICAgICAgIGNvbnN0IGNvb3JkaW5hdG9yID0gbmV3IFNpbXVsYXRvckNvb3JkaW5hdG9yKGNvbmZpZyk7XG5cbiAgICAgICAgY29uc3QgZGlzY292ZXIgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiRGlzY292ZXJpbmcgcmVzb3VyY2VzLi4uXCIpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIC8vIENsZWFyIHByZXZpb3VzIGNvbnN0cnVjdGlvbiBzdGF0ZVxuICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5jbGVhcigpO1xuXG4gICAgICAgICAgICAgICAgLy8gQ2xlYXIgcHJldmlvdXMgc2ltdWxhdGlvbiBzdGF0ZSBpbiBGdzI0XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LmdldFNpbXVsYXRlZExhbWJkYXMoKS5jbGVhcigpO1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdTSU1VTEFURURfQVBJX1JPVVRFUycsIFtdKTtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnU0lNVUxBVEVEX1FVRVVFUycsIFtdKTtcblxuICAgICAgICAgICAgICAgIC8vIDEuIFByb2Nlc3MgTW9kdWxlc1xuICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc01vZHVsZXMoKTtcblxuICAgICAgICAgICAgICAgIC8vIDIuIEJ1aWxkIENvbnN0cnVjdHMgKHRoaXMgd2lsbCBwb3B1bGF0ZSBzaW11bGF0ZWQgbWV0YWRhdGEgaW4gRncyNClcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmNvbnN0cnVjdEFsbFJlc291cmNlcygpO1xuXG4gICAgICAgICAgICAgICAgLy8gMy4gQ29sbGVjdCBNZXRhZGF0YVxuICAgICAgICAgICAgICAgIGNvbnN0IGxhbWJkYUNvbmZpZ3MgPSB0aGlzLmZ3MjQuZ2V0U2ltdWxhdGVkTGFtYmRhcygpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGFwaVJvdXRlcyA9IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdTSU1VTEFURURfQVBJX1JPVVRFUycpIHx8IFtdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHNxc1N1YnMgPSB0aGlzLmZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnU0lNVUxBVEVEX1FVRVVFUycpIHx8IFtdO1xuXG4gICAgICAgICAgICAgICAgY29vcmRpbmF0b3Iuc2V0TGFtYmRhQ29uZmlncyhsYW1iZGFDb25maWdzKTtcbiAgICAgICAgICAgICAgICBjb29yZGluYXRvci5zZXRBcGlSb3V0ZXMoYXBpUm91dGVzKTtcbiAgICAgICAgICAgICAgICBjb29yZGluYXRvci5zZXRTcXNTdWJzY3JpcHRpb25zKHNxc1N1YnMpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihcIkVycm9yIGR1cmluZyByZXNvdXJjZSBkaXNjb3Zlcnk6XCIsIGVycm9yKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IGRpc2NvdmVyKCk7XG5cbiAgICAgICAgLy8gMy4gU3RhcnQgU2ltdWxhdG9yXG4gICAgICAgIGF3YWl0IGNvb3JkaW5hdG9yLnN0YXJ0KCk7XG5cbiAgICAgICAgLy8gNC4gU2V0dXAgSE1SXG4gICAgICAgIGlmIChjb25maWcuaG90UmVsb2FkICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgY29uc3Qgd2F0Y2hlciA9IG5ldyBITVJXYXRjaGVyKCcuL3NyYycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQ2hhbmdlIGRldGVjdGVkLCByZWxvYWRpbmcuLi5cIik7XG4gICAgICAgICAgICAgICAgYXdhaXQgZGlzY292ZXIoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgd2F0Y2hlci5zdGFydCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlNpbXVsYXRvciBzdGFydGVkIHN1Y2Nlc3NmdWxseSFcIik7XG5cbiAgICAgICAgcmV0dXJuIGNvb3JkaW5hdG9yO1xuICAgIH1cblxufVxuIl19