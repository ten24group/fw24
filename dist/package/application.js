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
        // Setup observability infrastructure BEFORE modules/constructs
        // Uses DynamoDBConstruct internally with proper schema
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
}
exports.Application = Application;
__decorate([
    (0, logging_1.LogDuration)()
], Application.prototype, "run", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsNkNBQXlDO0FBQ3pDLDJEQUF5RTtBQUN6RSxzQ0FBbUM7QUFJbkMsK0VBQXlFO0FBQ3pFLHVDQUErRDtBQUMvRCw2Q0FBaUU7QUFDakUsbUNBQWdDO0FBQ2hDLDZDQUF5QztBQUN6Qyx5Q0FBNkM7QUFFN0MsTUFBYSxXQUFXO0lBQ1gsTUFBTSxDQUFVO0lBQ3pCLFNBQVMsQ0FBUztJQUVGLElBQUksQ0FBTztJQUNYLFdBQVcsQ0FBb0I7SUFDOUIsVUFBVSxDQUE2QjtJQUN2QyxPQUFPLENBQTJCO0lBQ2xDLG1CQUFtQixHQUErQixJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQzVELCtCQUErQixHQUFXLEVBQUUsQ0FBQztJQUN0RCxtQ0FBbUMsR0FBRyxDQUFDLENBQUM7SUFDL0IsbUJBQW1CLENBQXdCO0lBRTVELFlBQVksU0FBNkIsRUFBRTtRQUN2QyxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxDQUFFLFdBQVcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsV0FBVyxDQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFFNUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUNBQXFDLENBQUMsQ0FBQztRQUV4RCxJQUFJLENBQUMsSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUMvQixJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksd0NBQWlCLEVBQUUsQ0FBQztRQUMzQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUU1QixJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQzlCLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFB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cEIsRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUUsRUFBRTtnQkFDNUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUUsRUFBRTtnQkFDNUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUUsRUFBRTtnQkFDNUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUUsRUFBRTtnQkFDNUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUUsRUFBRTtnQkFDNUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUUsRUFBRTtnQkFDNUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUUsRUFBRTthQUMvSTtZQUNELEdBQUcsRUFBRSxDQUFDLEtBQUs7U0FDZCxDQUFDO1FBRUYsTUFBTSxlQUFlLEdBQUcsSUFBSSw4QkFBaUIsQ0FBQztZQUMxQyxTQUFTLEVBQUUsR0FBRyxDQUFDLFNBQVMsSUFBSSxZQUFZO1lBQ3hDLGVBQWUsRUFBRSxHQUFHLENBQUMsZUFBZTtZQUNwQyxLQUFLLEVBQUU7Z0JBQ0gsSUFBSSxFQUFFLFNBQVM7Z0JBQ2YsS0FBSyxFQUFFLFlBQVk7Z0JBQ25CLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTTtnQkFDakIsY0FBYyxFQUFFLEVBQUUsQ0FBQyxjQUFjO2FBQ3BDO1NBQ0osQ0FBQyxDQUFDO1FBRUgsZUFBZSxDQUFDLElBQUksR0FBRyx3QkFBd0IsQ0FBQztRQUNoRCxNQUFNLGVBQWUsQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUVsQyx5RUFBeUU7UUFDekUsSUFBSSxDQUFDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQztZQUM5QixNQUFNLEVBQUUsQ0FBRSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLENBQUUsV0FBVyxDQUFFLEVBQUUsQ0FBRTtTQUMzRCxDQUFDLENBQUM7UUFFSCxNQUFNLFFBQVEsR0FBRyxFQUFFLENBQUM7UUFDcEIsSUFBSSxpQkFBaUI7WUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQy9DLElBQUksZUFBZTtZQUFFLFFBQVEsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7UUFFN0MsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsb0JBQW9CLFNBQVMsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLEdBQUcsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDaEgsQ0FBQztJQUVEOztPQUVHO0lBQ0ssS0FBSyxDQUFDLDRCQUE0QixDQUFDLEdBQThCO1FBQ3JFLE1BQU0sRUFBRSxHQUFHLEdBQUcsQ0FBQyxVQUFXLENBQUM7UUFDM0IsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDO1FBQ3BELE1BQU0sWUFBWSxHQUFHLEVBQUUsQ0FBQyxZQUFZLElBQUksa0JBQWtCLE9BQU8sRUFBRSxDQUFDO1FBRXBFLDRDQUE0QztRQUM1QyxrREFBa0Q7UUFDbEQsSUFBSSxDQUFDLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyx5QkFBeUIsRUFBRSxZQUFZLENBQUMsQ0FBQztRQUVoRixJQUFJLEVBQUUsQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNuQixJQUFJLENBQUMsSUFBSSxDQUFDLDRCQUE0QixDQUFDLGtDQUFrQyxFQUFFLE1BQU0sQ0FBQyxFQUFFLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQztRQUN6RyxDQUFDO1FBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsK0JBQStCLFlBQVksRUFBRSxDQUFDLENBQUM7SUFDcEUsQ0FBQztDQUVKO0FBclZELGtDQXFWQztBQTNQZ0I7SUFEWixJQUFBLHFCQUFXLEdBQUU7c0NBeURiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQXBwLCBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgQXR0cmlidXRlVHlwZSwgU3RyZWFtVmlld1R5cGUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBJQXBwbGljYXRpb25Db25maWcsIElPYnNlcnZhYmlsaXR5Q29uZmlnLCBJT2JzZXJ2YWJpbGl0eUluZnJhQ29uZmlnIH0gZnJvbSBcIi4vaW50ZXJmYWNlcy9jb25maWdcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QgfSBmcm9tIFwiLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgSUZ3MjRNb2R1bGUgfSBmcm9tIFwiLi9jb3JlL3J1bnRpbWUvbW9kdWxlXCI7XG5pbXBvcnQgeyBFbnRpdHlVSUNvbmZpZ0dlbiB9IGZyb20gXCIuL3VpLWNvbmZpZy1nZW4vZW50aXR5LXVpLWNvbmZpZy5nZW5cIjtcbmltcG9ydCB7IElMb2dnZXIsIExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBEeW5hbW9EQkNvbnN0cnVjdCwgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyBUaW1lciB9IGZyb20gXCIuL3V0aWxzXCI7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnbm9kZTpjcnlwdG8nO1xuaW1wb3J0IHsgam9pbiBhcyBwYXRoSm9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBjbGFzcyBBcHBsaWNhdGlvbiB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyOiBJTG9nZ2VyO1xuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgcHVibGljIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQ7XG4gICAgcHVibGljIHJlYWRvbmx5IHVpQ29uZmlnR2VuOiBFbnRpdHlVSUNvbmZpZ0dlbjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbnN0cnVjdHM6IE1hcDxzdHJpbmcsIEZXMjRDb25zdHJ1Y3Q+O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgbW9kdWxlczogTWFwPHN0cmluZywgSUZ3MjRNb2R1bGU+O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgcHJvY2Vzc2VkQ29uc3RydWN0czogTWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj4gPSBuZXcgTWFwKCk7XG4gICAgcHJpdmF0ZSByZWFkb25seSByZXNvdXJjZUNvbnN0cnVjdE1heENvbmN1cnJlbmN5OiBudW1iZXIgPSAxMDtcbiAgICBwcml2YXRlIHJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5ID0gMDtcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9ic2VydmFiaWxpdHlDb25maWc/OiBJT2JzZXJ2YWJpbGl0eUNvbmZpZztcblxuICAgIGNvbnN0cnVjdG9yKGNvbmZpZzogSUFwcGxpY2F0aW9uQ29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dnZXIgPSBjcmVhdGVMb2dnZXIoWyBBcHBsaWNhdGlvbi5uYW1lLCBjb25maWcubmFtZSwgY29uZmlnLmVudmlyb25tZW50IF0uam9pbignLScpKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiSW5pdGlhbGl6aW5nIGZ3MjQgaW5mcmFzdHJ1Y3R1cmUuLi5cIik7XG5cbiAgICAgICAgdGhpcy5mdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgICAgICB0aGlzLnVpQ29uZmlnR2VuID0gbmV3IEVudGl0eVVJQ29uZmlnR2VuKCk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25maWcoY29uZmlnKTtcblxuICAgICAgICBpZiAoY29uZmlnLmVudmlyb25tZW50VmFyaWFibGVzKSB7XG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhjb25maWcuZW52aXJvbm1lbnRWYXJpYWJsZXMpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5nbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcykge1xuICAgICAgICAgICAgT2JqZWN0LmVudHJpZXMoY29uZmlnLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKS5mb3JFYWNoKChbIGtleSwgdmFsdWUgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFwcGx5IGdsb2JhbCBwb2xpY2llcyBmcm9tIGNvbmZpZ1xuICAgICAgICBpZiAoY29uZmlnLmdsb2JhbFBvbGljaWVzKSB7XG4gICAgICAgICAgICBjb25maWcuZ2xvYmFsUG9saWNpZXMuZm9yRWFjaChwb2xpY3kgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5hZGRHbG9iYWxQb2xpY3kocG9saWN5KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXBwbHkgZ2xvYmFsIHJlc291cmNlIGFjY2VzcyBmcm9tIGNvbmZpZ1xuICAgICAgICBpZiAoY29uZmlnLmdsb2JhbFJlc291cmNlQWNjZXNzKSB7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0R2xvYmFsUmVzb3VyY2VBY2Nlc3MoY29uZmlnLmdsb2JhbFJlc291cmNlQWNjZXNzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGVuc3VyZSB0aGVyZSdzIGEgbG9nLWxldmVsIHNldCBpbiB0aGUgZncyNCBzY29wZSBzbyB0aGF0IHRoZSBjb25zdHJ1Y3RzIGNhbiBhc2sgZm9yIHRoaXMgdmFsdWVcbiAgICAgICAgLy8gdGhpcydzIG9ubHkgdGhlIGdsb2JhbCB2YWx1ZSwgYW5kIGNhbiBiZSBvdmVycmlkZGVuIGJ5IGVhY2ggbGFtYmRhIGZ1bmN0aW9uLlxuICAgICAgICBpZiAoIXRoaXMuZncyNC5oYXNFbnZpcm9ubWVudFZhcmlhYmxlKCdMT0dfTEVWRUwnKSkge1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcsIHByb2Nlc3MuZW52LkxPR19MRVZFTCB8fCAnSU5GTycpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU3RvcmUgb2JzZXJ2YWJpbGl0eSBjb25maWcgZm9yIHByb2Nlc3NpbmcgaW4gcnVuKClcbiAgICAgICAgaWYgKGNvbmZpZy5vYnNlcnZhYmlsaXR5KSB7XG4gICAgICAgICAgICB0aGlzLm9ic2VydmFiaWxpdHlDb25maWcgPSBjb25maWcub2JzZXJ2YWJpbGl0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuY29uc3RydWN0cyA9IG5ldyBNYXAoKTtcbiAgICAgICAgdGhpcy5tb2R1bGVzID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIGluaXRpYWxpemUgdGhlIG1haW4gc3RhY2tcbiAgICAgICAgY29uc3QgYXBwID0gbmV3IEFwcCgpO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0QXBwKGFwcCk7XG5cbiAgICB9XG5cbiAgICBwdWJsaWMgdXNlKGNvbnN0cnVjdDogRlcyNENvbnN0cnVjdCk6IHRoaXMge1xuICAgICAgICB0aGlzLnJlZ2lzdGVyQ29uc3RydWN0KGNvbnN0cnVjdCk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHB1YmxpYyB1c2VNb2R1bGUobW9kdWxlOiBJRncyNE1vZHVsZSk6IHRoaXMge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNhbGxlZCBVc2VNb2R1bGUgd2l0aCBtb2R1bGU6IFwiLCB7IG1vZHVsZU5hbWU6IG1vZHVsZS5nZXROYW1lKCkgfSk7XG5cbiAgICAgICAgaWYgKHRoaXMubW9kdWxlcy5oYXMobW9kdWxlLmdldE5hbWUoKSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kdWxlIHdpdGggbmFtZSAke21vZHVsZS5nZXROYW1lKCl9IGlzIGFscmVhZHkgcmVnaXN0ZXJlZC5gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubW9kdWxlcy5zZXQobW9kdWxlLmdldE5hbWUoKSwgbW9kdWxlKTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsgY29uc3RydWN0TmFtZSwgY29uc3RydWN0IF0gb2YgbW9kdWxlLmdldENvbnN0cnVjdHMoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlVzZU1vZHVsZTogUmVnaXN0ZXJpbmcgY29uc3RydWN0OiBcIiwgY29uc3RydWN0TmFtZSwgbW9kdWxlLmdldERlcGVuZGVuY2llcygpLCBjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgIGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMgPSBtb2R1bGUuZ2V0RGVwZW5kZW5jaWVzKCk7XG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ29uc3RydWN0KGNvbnN0cnVjdCwgY29uc3RydWN0TmFtZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBydW4oKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJSdW5uaW5nIGZ3MjQgaW5mcmFzdHJ1Y3R1cmUuLi5cIik7XG5cbiAgICAgICAgLy8gKioqIG9yZGVyIGlzIGltcG9ydGFudCBoZXJlLCBtb2R1bGVzIG5lZWQgdG8gYmUgcHJvY2Vzc2VkIGZpcnN0LCBiZWZvcmUgY29uc3RydWN0cyAqKipcbiAgICAgICAgdGhpcy5wcm9jZXNzTW9kdWxlcygpO1xuXG4gICAgICAgIGNvbnN0IGRpc2FibGVVSUNvbmZpZ0dlbiA9IEZ3MjQuZ2V0SW5zdGFuY2UoKS5nZXRDb25maWcoKS5kaXNhYmxlVUlDb25maWdHZW47XG5cbiAgICAgICAgaWYgKCFkaXNhYmxlVUlDb25maWdHZW4pIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMudWlDb25maWdHZW4ucnVuKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjb25maWd1cmUgYSBidWlsZCBjb21tYW5kIGxpa2UgaW4gcGFja2FnZS5qc29uIHRvIG9ubHkgZ2VuZXJhdGUgdGhlIHVpIGNvbmZpZ1xuICAgICAgICAvLyBcInVpOmdlblwiOiBcIlVJX0dFTl9PTkxZPXRydWUgZW52LWNtZCAtZiAuZW52LmxvY2FsIHRzLW5vZGUgc3JjL2luZGV4LnRzXCJcbiAgICAgICAgLy8gdGhpcyBpcyB1c2VmdWwgZm9yIGdlbmVyYXRpbmcgdGhlIHVpIGNvbmZpZyBkdXJpbmcgZGV2ZWxvcG1lbnRcbiAgICAgICAgaWYgKHByb2Nlc3MuZW52LlVJX0dFTl9PTkxZID09PSAndHJ1ZScpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1VJIGNvbmZpZyBnZW5lcmF0aW9uIGNvbXBsZXRlLiBFeGl0aW5nLicpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGRlZmF1bHQgZncyNCBydW50aW1lIGxheWVyIChPTkxZIHJ1bnRpbWUgY29kZSwgbm90IGluZnJhc3RydWN0dXJlKVxuICAgICAgICAvLyBUaGlzIGxheWVyIGlzIGF1dG9tYXRpY2FsbHkgYXR0YWNoZWQgdG8gYWxsIExhbWJkYSBmdW5jdGlvbnNcbiAgICAgICAgLy8gSXQncyBOT1QgYW4gZW50cnkgcGFja2FnZSAtIGl0J3MganVzdCBhdmFpbGFibGUgZm9yIGltcG9ydHNcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkJ1aWxkaW5nIGZ3MjQgcnVudGltZSBsYXllci4uLlwiKTtcbiAgICAgICAgY29uc3QgZncyNExheWVyID0gbmV3IExheWVyQ29uc3RydWN0KFsge1xuICAgICAgICAgICAgbW9kZTogJ0JVSUxEX0FORF9QQUNLQUdFJyxcbiAgICAgICAgICAgIC8vIEJ1bmRsZSB0aGUgZncyNCBydW50aW1lIHNvdXJjZSAoaGFzIGltcG9ydHMsIG5lZWRzIGJ1bmRsaW5nIHdpdGggZXNidWlsZClcbiAgICAgICAgICAgIHNvdXJjZVBhdGg6ICcuL25vZGVfbW9kdWxlcy9AdGVuMjRncm91cC9mdzI0L2Rpc3QvcGFja2FnZS9sYXllci9mdzI0LmpzJyxcbiAgICAgICAgICAgIHBhY2thZ2VQYXRoOiAnQHRlbjI0Z3JvdXAvZncyNCcsXG4gICAgICAgICAgICBwcmlvcml0eTogMCxcbiAgICAgICAgICAgIC8vIE91dHB1dCB0byBhcHBsaWNhdGlvbidzIGRpc3QvbGF5ZXJzIGRpcmVjdG9yeSwgbm90IGZyYW1ld29yaydzIGRpcmVjdG9yeVxuICAgICAgICAgICAgZGlzdERpcmVjdG9yeTogcGF0aEpvaW4ocHJvY2Vzcy5jd2QoKSwgJ2Rpc3QvbGF5ZXJzJyksXG4gICAgICAgICAgICBidWlsZE9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICAgICAgICAgICAgZXh0ZXJuYWw6IFsgJ0Bhd3Mtc2RrJywgJ0BzbWl0aHknIF0gLy8gQVdTIFNESyBpcyBOT1QgcHJvdmlkZWQgYnkgTGFtYmRhIHJ1bnRpbWVcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBpc0VudHJ5UGFja2FnZTogZmFsc2UsXG4gICAgICAgIH0gXSk7XG4gICAgICAgIGF3YWl0IGZ3MjRMYXllci5jb25zdHJ1Y3QoKTtcblxuICAgICAgICAvLyBTZXR1cCBvYnNlcnZhYmlsaXR5IGluZnJhc3RydWN0dXJlIEJFRk9SRSBtb2R1bGVzL2NvbnN0cnVjdHNcbiAgICAgICAgLy8gVXNlcyBEeW5hbW9EQkNvbnN0cnVjdCBpbnRlcm5hbGx5IHdpdGggcHJvcGVyIHNjaGVtYVxuICAgICAgICBpZiAodGhpcy5vYnNlcnZhYmlsaXR5Q29uZmlnKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnNldHVwT2JzZXJ2YWJpbGl0eSh0aGlzLm9ic2VydmFiaWxpdHlDb25maWcpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdG90YWxDb25zdHJ1Y3RzID0gdGhpcy5jb25zdHJ1Y3RzLnNpemU7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCR7Jz0nLnJlcGVhdCg2MCl9YCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCfmoAgQnVpbGRpbmcgJHt0b3RhbENvbnN0cnVjdHN9IGNvbnN0cnVjdChzKS4uLmApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfVxcbmApO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuY29uc3RydWN0QWxsUmVzb3VyY2VzKClcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfWApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgQWxsIGNvbnN0cnVjdHMgY29tcGxldGVkIHN1Y2Nlc3NmdWxseWApO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAkeyc9Jy5yZXBlYXQoNjApfVxcbmApO1xuICAgIH1cblxuXG4gICAgcHJpdmF0ZSByZWdpc3RlckNvbnN0cnVjdChjb25zdHJ1Y3Q6IEZXMjRDb25zdHJ1Y3QsIG5hbWU/OiBzdHJpbmcpIHtcbiAgICAgICAgbGV0IGNvbnN0cnVjdE5hbWUgPSBuYW1lIHx8IGNvbnN0cnVjdC5uYW1lO1xuICAgICAgICBpZiAodGhpcy5jb25zdHJ1Y3RzLmhhcyhjb25zdHJ1Y3ROYW1lKSkge1xuICAgICAgICAgICAgLy8gaGFuZGxlIG11bHRpcGxlIGNvbnN0cnVjdHMgb2Ygc2FtZSB0eXBlXG4gICAgICAgICAgICBjb25zdCBuZXdDb25zdHJ1Y3ROYW1lID0gY29uc3RydWN0TmFtZS5jb25jYXQoJy0nLCByYW5kb21VVUlEKCkpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29uc3RydWN0IHdpdGggbmFtZSAke2NvbnN0cnVjdE5hbWV9IGlzIGFscmVhZHkgcmVnaXN0ZXJlZCwgcmVuYW1pbmcgdG8gJHtuZXdDb25zdHJ1Y3ROYW1lfWApO1xuICAgICAgICAgICAgY29uc3RydWN0TmFtZSA9IG5ld0NvbnN0cnVjdE5hbWU7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5jb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3QpO1xuICAgICAgICB0aGlzLmZ3MjQuYWRkQ29uc3RydWN0KGNvbnN0cnVjdCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBwcm9jZXNzTW9kdWxlcygpIHtcbiAgICAgICAgZm9yIChjb25zdCBbIG1vZHVsZU5hbWUsIG1vZHVsZSBdIG9mIHRoaXMubW9kdWxlcykge1xuICAgICAgICAgICAgdGhpcy5mdzI0LmFkZE1vZHVsZShtb2R1bGVOYW1lLCBtb2R1bGUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjb25zdHJ1Y3RBbGxSZXNvdXJjZXMoKSB7XG4gICAgICAgIGNvbnN0IGFsbENvbnN0cnVjdHMgPSBBcnJheS5mcm9tKHRoaXMuY29uc3RydWN0cy5rZXlzKCkpLm1hcChjb25zdHJ1Y3ROYW1lID0+IHRoaXMuY29uc3RydWN0UmVzb3VyY2VzKGNvbnN0cnVjdE5hbWUpKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKGFsbENvbnN0cnVjdHMpO1xuICAgIH1cblxuICAgIGFzeW5jIGNvbnN0cnVjdFJlc291cmNlcyhjb25zdHJ1Y3ROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgY29uc3RydWN0ID0gdGhpcy5jb25zdHJ1Y3RzLmdldChjb25zdHJ1Y3ROYW1lKTtcbiAgICAgICAgaWYgKCFjb25zdHJ1Y3QpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29uc3RydWN0ICR7Y29uc3RydWN0TmFtZX0gbm90IGZvdW5kYCk7XG4gICAgICAgIH1cblxuICAgICAgICB3aGlsZSAodGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSA+PSB0aGlzLnJlc291cmNlQ29uc3RydWN0TWF4Q29uY3VycmVuY3kpIHtcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDApKTsgLy8gVGhyb3R0bGUgaWYgY29uY3VycmVuY3kgbGltaXQgaXMgcmVhY2hlZFxuICAgICAgICB9XG5cbiAgICAgICAgLy8gT25seSBsb2cgaWYgdGhlcmUgYXJlIGFjdHVhbCBkZXBlbmRlbmNpZXNcbiAgICAgICAgaWYgKGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMgJiYgY29uc3RydWN0LmRlcGVuZGVuY2llcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhg4o+zICR7Y29uc3RydWN0TmFtZX06IFdhaXRpbmcgZm9yIGRlcGVuZGVuY2llczogJHtjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBXYWl0IGZvciBkZXBlbmRlbmNpZXMgdG8gcmVzb2x2ZVxuICAgICAgICBhd2FpdCB0aGlzLndhaXRGb3JEZXBlbmRlbmNpZXMoY29uc3RydWN0LmRlcGVuZGVuY2llcywgY29uc3RydWN0TmFtZSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg8J+UqCBCdWlsZGluZyAke2NvbnN0cnVjdE5hbWV9Li4uYCk7XG5cbiAgICAgICAgdGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSsrO1xuICAgICAgICBjb25zdCB0aW1lciA9IFRpbWVyLnN0YXJ0KCk7XG4gICAgICAgIGNvbnN0IGNvbnN0cnVjdENvbXBsZXRpb25Qcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgY29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSAke2NvbnN0cnVjdE5hbWV9IGNvbXBsZXRlZCBpbiAke3RpbWVyLmVsYXBzZWRTZWNvbmRzKCl9YCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGDinYwgJHtjb25zdHJ1Y3ROYW1lfSBmYWlsZWQ6YCwgZXJyb3IpO1xuICAgICAgICAgICAgICAgIHRocm93IGVycm9yOyAvLyBSZS10aHJvdyB0byBlbnN1cmUgZGVwbG95bWVudCBmYWlsc1xuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5LS07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKCk7XG5cbiAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZSk7XG4gICAgICAgIHJldHVybiBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHdhaXRGb3JEZXBlbmRlbmNpZXMoZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSwgY29uc3RydWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghZGVwZW5kZW5jaWVzIHx8IGRlcGVuZGVuY2llcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gZGVwZW5kZW5jaWVzLm1hcChkZXBlbmRlbmN5ID0+IHtcbiAgICAgICAgICAgIC8vIGlmIGRlcGVuZGVuY3kgY29uc3RydWN0IGRvZXMgbm90IGV4aXN0cyBpbiB0aGUgY29uc3RydWN0IGxpc3QsIG1hcmsgaXQgYXMgcHJvY2Vzc2VkXG4gICAgICAgICAgICBpZiAoIXRoaXMuY29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtjb25zdHJ1Y3ROYW1lfTogRGVwZW5kZW5jeSAke2RlcGVuZGVuY3l9IG5vdCByZWdpc3RlcmVkIChvcHRpb25hbCBkZXBlbmRlbmN5KWApO1xuICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5zZXQoZGVwZW5kZW5jeSwgUHJvbWlzZS5yZXNvbHZlKCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCF0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgLy8gSWYgZGVwZW5kZW5jeSBub3Qgc2NoZWR1bGVkIHlldCwgbGlzdGVuIGZvciBpdHMgYWRkaXRpb25cbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJJbnRlcnZhbChpbnRlcnZhbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmdldChkZXBlbmRlbmN5KSEudGhlbihyZXNvbHZlLCByZWplY3QpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LCAxMDApOyAvLyBDaGVjayBldmVyeSAxMDBtc1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5nZXQoZGVwZW5kZW5jeSkhO1xuICAgICAgICB9KTtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNldHVwIG9ic2VydmFiaWxpdHkgaW5mcmFzdHJ1Y3R1cmUuXG4gICAgICogLSBgdHJ1ZWAgPSBEeW5hbW9EQiB3aXRoIGRlZmF1bHRzXG4gICAgICogLSBgeyBkeW5hbW9kYjogey4uLn0gfWAgPSBEeW5hbW9EQiB0YWJsZVxuICAgICAqIC0gYHsgY2xvdWR3YXRjaDogey4uLn0gfWAgPSBDdXN0b20gQ2xvdWRXYXRjaCBsb2cgZ3JvdXAgKG5vIER5bmFtb0RCKVxuICAgICAqIC0gYHsgZHluYW1vZGI6IHsuLi59LCBjbG91ZHdhdGNoOiB7Li4ufSB9YCA9IEJvdGhcbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHNldHVwT2JzZXJ2YWJpbGl0eShjb25maWc6IHRydWUgfCBJT2JzZXJ2YWJpbGl0eUluZnJhQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIHRydWUgPSBzaG9ydGhhbmQgZm9yIHsgZHluYW1vZGI6IHt9IH1cbiAgICAgICAgY29uc3QgY2ZnOiBJT2JzZXJ2YWJpbGl0eUluZnJhQ29uZmlnID0gY29uZmlnID09PSB0cnVlID8geyBkeW5hbW9kYjoge30gfSA6IGNvbmZpZztcblxuICAgICAgICAvLyBTZXR1cCBDbG91ZFdhdGNoIGlmIGNvbmZpZ3VyZWRcbiAgICAgICAgaWYgKGNmZy5jbG91ZHdhdGNoPy5lbmFibGVkICE9PSBmYWxzZSAmJiBjZmcuY2xvdWR3YXRjaCkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5zZXR1cE9ic2VydmFiaWxpdHlDbG91ZFdhdGNoKGNmZyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTZXR1cCBEeW5hbW9EQiBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmIChjZmcuZHluYW1vZGI/LmVuYWJsZWQgIT09IGZhbHNlICYmIGNmZy5keW5hbW9kYikge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5zZXR1cE9ic2VydmFiaWxpdHlEeW5hbW9EQihjZmcpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTG9nIGlmIG5laXRoZXIgYmFja2VuZCBpcyBjb25maWd1cmVkXG4gICAgICAgIGlmICghY2ZnLmR5bmFtb2RiICYmICFjZmcuY2xvdWR3YXRjaCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygn4pqg77iPIE9ic2VydmFiaWxpdHkgZW5hYmxlZCBidXQgbm8gYmFja2VuZHMgY29uZmlndXJlZCcpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0dXAgRHluYW1vREIgaW5mcmFzdHJ1Y3R1cmUgZm9yIG9ic2VydmFiaWxpdHkuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBzZXR1cE9ic2VydmFiaWxpdHlEeW5hbW9EQihjZmc6IElPYnNlcnZhYmlsaXR5SW5mcmFDb25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgZGIgPSBjZmcuZHluYW1vZGIhO1xuICAgICAgICAvLyBUYWJsZSBuYW1lOiB1c2UgZGIubmFtZSBpZiBwcm92aWRlZCwgb3RoZXJ3aXNlICdvYnNlcnZhYmlsaXR5bG9ncydcbiAgICAgICAgLy8gTm8gYXBwTmFtZSBwcmVmaXggLSBrZWVwcyB0YWJsZUtleSBzaW1wbGUgYW5kIGNvbnZlbnRpb24tYmFzZWRcbiAgICAgICAgY29uc3QgdGFibGVOYW1lID0gZGIubmFtZSA/PyAnb2JzZXJ2YWJpbGl0eWxvZ3MnO1xuXG4gICAgICAgIC8vIENoZWNrIGlmIHN0cmVhbSBuZWVkZWRcbiAgICAgICAgY29uc3QgaGFzU2VhcmNoSW5kZXhpbmcgPSBkYi5zZWFyY2hJbmRleGluZz8uc29tZSgoczogeyBlbmFibGVkPzogYm9vbGVhbiB9KSA9PiBzLmVuYWJsZWQpO1xuICAgICAgICBjb25zdCBoYXNTdHJlYW1Db25maWcgPSBkYi5zdHJlYW0/LmVuYWJsZWQ7XG4gICAgICAgIGNvbnN0IG5lZWRzU3RyZWFtID0gaGFzU2VhcmNoSW5kZXhpbmcgfHwgaGFzU3RyZWFtQ29uZmlnO1xuXG4gICAgICAgIC8vIERlZmF1bHQgdGFibGUgcHJvcHMgKDYgR1NJcylcbiAgICAgICAgY29uc3QgZGVmYXVsdFByb3BzID0ge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdwaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogbmVlZHNTdHJlYW0gPyBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBnbG9iYWxTZWNvbmRhcnlJbmRleGVzOiBbXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2kxJywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2kxcGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2kxc2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2kyJywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2kycGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2kyc2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2kzJywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2kzcGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2kzc2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k0JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k0cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k0c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k1JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k1cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k1c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k2JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k2cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k2c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k3JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k3cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k3c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgLi4uZGIucHJvcHMsXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgZHluYW1vQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KHtcbiAgICAgICAgICAgIHN0YWNrTmFtZTogY2ZnLnN0YWNrTmFtZSA/PyAncGVyc2lzdGVudCcsXG4gICAgICAgICAgICBwYXJlbnRTdGFja05hbWU6IGNmZy5wYXJlbnRTdGFja05hbWUsXG4gICAgICAgICAgICB0YWJsZToge1xuICAgICAgICAgICAgICAgIG5hbWU6IHRhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICBwcm9wczogZGVmYXVsdFByb3BzLFxuICAgICAgICAgICAgICAgIHN0cmVhbTogZGIuc3RyZWFtLFxuICAgICAgICAgICAgICAgIHNlYXJjaEluZGV4aW5nOiBkYi5zZWFyY2hJbmRleGluZyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGR5bmFtb0NvbnN0cnVjdC5uYW1lID0gJ29ic2VydmFiaWxpdHktZHluYW1vZGInO1xuICAgICAgICBhd2FpdCBkeW5hbW9Db25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgICAgLy8gQWRkIGdsb2JhbCByZXNvdXJjZSBhY2Nlc3MgLSBMYW1iZGFGdW5jdGlvbiBzZXRzIGVudiB2YXIgYXV0b21hdGljYWxseVxuICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsUmVzb3VyY2VBY2Nlc3Moe1xuICAgICAgICAgICAgdGFibGVzOiBbIHsgbmFtZTogdGFibGVOYW1lLCBhY2Nlc3M6IFsgJ3JlYWR3cml0ZScgXSB9IF0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XG4gICAgICAgIGlmIChoYXNTZWFyY2hJbmRleGluZykgZmVhdHVyZXMucHVzaCgnc2VhcmNoJyk7XG4gICAgICAgIGlmIChoYXNTdHJlYW1Db25maWcpIGZlYXR1cmVzLnB1c2goJ3N0cmVhbScpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSBPYnNlcnZhYmlsaXR5OiAke3RhYmxlTmFtZX0ke2ZlYXR1cmVzLmxlbmd0aCA/ICcgKCcgKyBmZWF0dXJlcy5qb2luKCcsICcpICsgJyknIDogJyd9YCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0dXAgQ2xvdWRXYXRjaCBpbmZyYXN0cnVjdHVyZSBmb3Igb2JzZXJ2YWJpbGl0eS5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHNldHVwT2JzZXJ2YWJpbGl0eUNsb3VkV2F0Y2goY2ZnOiBJT2JzZXJ2YWJpbGl0eUluZnJhQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGN3ID0gY2ZnLmNsb3Vkd2F0Y2ghO1xuICAgICAgICBjb25zdCBhcHBOYW1lID0gdGhpcy5mdzI0LmdldENvbmZpZygpLm5hbWUgfHwgJ2FwcCc7XG4gICAgICAgIGNvbnN0IGxvZ0dyb3VwTmFtZSA9IGN3LmxvZ0dyb3VwTmFtZSA/PyBgL29ic2VydmFiaWxpdHkvJHthcHBOYW1lfWA7XG5cbiAgICAgICAgLy8gVE9ETzogQ3JlYXRlIGN1c3RvbSBsb2cgZ3JvdXAgd2hlbiBuZWVkZWRcbiAgICAgICAgLy8gRm9yIG5vdywganVzdCBzZXQgZW52IHZhciBzbyBydW50aW1lIGNhbiB1c2UgaXRcbiAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGUoJ09CU0VSVkFCSUxJVFlfTE9HX0dST1VQJywgbG9nR3JvdXBOYW1lKTtcblxuICAgICAgICBpZiAoY3cucmV0ZW50aW9uRGF5cykge1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGUoJ09CU0VSVkFCSUxJVFlfTE9HX1JFVEVOVElPTl9EQVlTJywgU3RyaW5nKGN3LnJldGVudGlvbkRheXMpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSBPYnNlcnZhYmlsaXR5IENsb3VkV2F0Y2g6ICR7bG9nR3JvdXBOYW1lfWApO1xuICAgIH1cblxufVxuIl19