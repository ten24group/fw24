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
}
exports.Application = Application;
__decorate([
    (0, logging_1.LogDuration)()
], Application.prototype, "run", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsNkNBQXlDO0FBQ3pDLDJEQUF5RTtBQUN6RSxzQ0FBbUM7QUFJbkMsK0VBQXlFO0FBQ3pFLHVDQUErRDtBQUMvRCw2Q0FBaUU7QUFDakUsbUNBQWdDO0FBQ2hDLDZDQUF5QztBQUN6Qyx5Q0FBNkM7QUFFN0MsTUFBYSxXQUFXO0lBQ1gsTUFBTSxDQUFVO0lBQ3pCLFNBQVMsQ0FBUztJQUVGLElBQUksQ0FBTztJQUNYLFdBQVcsQ0FBb0I7SUFDOUIsVUFBVSxDQUE2QjtJQUN2QyxPQUFPLENBQTJCO0lBQ2xDLG1CQUFtQixHQUErQixJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQzVELCtCQUErQixHQUFXLEVBQUUsQ0FBQztJQUN0RCxtQ0FBbUMsR0FBRyxDQUFDLENBQUM7SUFDL0IsbUJBQW1CLENBQXdCO0lBRTVELFlBQVksU0FBNkIsRUFBRTtRQUN2QyxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxDQUFFLFdBQVcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsV0FBVyxDQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFFNUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUNBQXFDLENBQUMsQ0FBQztRQUV4RCxJQUFJLENBQUMsSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUMvQixJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksd0NBQWlCLEVBQUUsQ0FBQztRQUMzQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUU1QixJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQzlCLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFB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QUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUUsRUFBRSxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFO2dCQUM1SSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUUsRUFBRSxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFO2dCQUM1SSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUUsRUFBRSxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFO2dCQUM1SSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUUsRUFBRSxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFO2dCQUM1SSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUUsRUFBRSxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSw0QkFBYSxDQUFDLE1BQU0sRUFBRSxFQUFFO2dCQUM1SSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsWUFBWSxF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QUksQ0FBQywrQkFBK0IsWUFBWSxFQUFFLENBQUMsQ0FBQztJQUNwRSxDQUFDO0NBRUo7QUFwWEQsa0NBb1hDO0FBMVJnQjtJQURaLElBQUEscUJBQVcsR0FBRTtzQ0E2RGIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBcHAsIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBBdHRyaWJ1dGVUeXBlLCBTdHJlYW1WaWV3VHlwZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IElBcHBsaWNhdGlvbkNvbmZpZywgSU9ic2VydmFiaWxpdHlDb25maWcsIElPYnNlcnZhYmlsaXR5SW5mcmFDb25maWcgfSBmcm9tIFwiLi9pbnRlcmZhY2VzL2NvbmZpZ1wiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCB9IGZyb20gXCIuL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBJRncyNE1vZHVsZSB9IGZyb20gXCIuL2NvcmUvcnVudGltZS9tb2R1bGVcIjtcbmltcG9ydCB7IEVudGl0eVVJQ29uZmlnR2VuIH0gZnJvbSBcIi4vdWktY29uZmlnLWdlbi9lbnRpdHktdWktY29uZmlnLmdlblwiO1xuaW1wb3J0IHsgSUxvZ2dlciwgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuL2xvZ2dpbmdcIjtcbmltcG9ydCB7IER5bmFtb0RCQ29uc3RydWN0LCBMYXllckNvbnN0cnVjdCB9IGZyb20gXCIuL2NvbnN0cnVjdHNcIjtcbmltcG9ydCB7IFRpbWVyIH0gZnJvbSBcIi4vdXRpbHNcIjtcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgeyBqb2luIGFzIHBhdGhKb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IGNsYXNzIEFwcGxpY2F0aW9uIHtcbiAgICByZWFkb25seSBsb2dnZXI6IElMb2dnZXI7XG4gICAgbWFpblN0YWNrITogU3RhY2s7XG5cbiAgICBwdWJsaWMgcmVhZG9ubHkgZncyNDogRncyNDtcbiAgICBwdWJsaWMgcmVhZG9ubHkgdWlDb25maWdHZW46IEVudGl0eVVJQ29uZmlnR2VuO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY29uc3RydWN0czogTWFwPHN0cmluZywgRlcyNENvbnN0cnVjdD47XG4gICAgcHJpdmF0ZSByZWFkb25seSBtb2R1bGVzOiBNYXA8c3RyaW5nLCBJRncyNE1vZHVsZT47XG4gICAgcHJpdmF0ZSByZWFkb25seSBwcm9jZXNzZWRDb25zdHJ1Y3RzOiBNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+PiA9IG5ldyBNYXAoKTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJlc291cmNlQ29uc3RydWN0TWF4Q29uY3VycmVuY3k6IG51bWJlciA9IDEwO1xuICAgIHByaXZhdGUgcmVzb3VyY2VDb25zdHJ1Y3RDdXJyZW50Q29uY3VycmVuY3kgPSAwO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgb2JzZXJ2YWJpbGl0eUNvbmZpZz86IElPYnNlcnZhYmlsaXR5Q29uZmlnO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnOiBJQXBwbGljYXRpb25Db25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihbIEFwcGxpY2F0aW9uLm5hbWUsIGNvbmZpZy5uYW1lLCBjb25maWcuZW52aXJvbm1lbnQgXS5qb2luKCctJykpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJJbml0aWFsaXppbmcgZncyNCBpbmZyYXN0cnVjdHVyZS4uLlwiKTtcblxuICAgICAgICB0aGlzLmZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgICAgIHRoaXMudWlDb25maWdHZW4gPSBuZXcgRW50aXR5VUlDb25maWdHZW4oKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbmZpZyhjb25maWcpO1xuXG4gICAgICAgIGlmIChjb25maWcuZW52aXJvbm1lbnRWYXJpYWJsZXMpIHtcbiAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKGNvbmZpZy5lbnZpcm9ubWVudFZhcmlhYmxlcykuZm9yRWFjaCgoWyBrZXksIHZhbHVlIF0pID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnLmdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKSB7XG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhjb25maWcuZ2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXBwbHkgZ2xvYmFsIHBvbGljaWVzIGZyb20gY29uZmlnXG4gICAgICAgIGlmIChjb25maWcuZ2xvYmFsUG9saWNpZXMpIHtcbiAgICAgICAgICAgIGNvbmZpZy5nbG9iYWxQb2xpY2llcy5mb3JFYWNoKHBvbGljeSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LmFkZEdsb2JhbFBvbGljeShwb2xpY3kpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBcHBseSBnbG9iYWwgcmVzb3VyY2UgYWNjZXNzIGZyb20gY29uZmlnXG4gICAgICAgIGlmIChjb25maWcuZ2xvYmFsUmVzb3VyY2VBY2Nlc3MpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRHbG9iYWxSZXNvdXJjZUFjY2Vzcyhjb25maWcuZ2xvYmFsUmVzb3VyY2VBY2Nlc3MpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gZW5zdXJlIHRoZXJlJ3MgYSBsb2ctbGV2ZWwgc2V0IGluIHRoZSBmdzI0IHNjb3BlIHNvIHRoYXQgdGhlIGNvbnN0cnVjdHMgY2FuIGFzayBmb3IgdGhpcyB2YWx1ZVxuICAgICAgICAvLyB0aGlzJ3Mgb25seSB0aGUgZ2xvYmFsIHZhbHVlLCBhbmQgY2FuIGJlIG92ZXJyaWRkZW4gYnkgZWFjaCBsYW1iZGEgZnVuY3Rpb24uXG4gICAgICAgIGlmICghdGhpcy5mdzI0Lmhhc0Vudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcpKSB7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnTE9HX0xFVkVMJywgcHJvY2Vzcy5lbnYuTE9HX0xFVkVMIHx8ICdJTkZPJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTdG9yZSBvYnNlcnZhYmlsaXR5IGNvbmZpZyBmb3IgcHJvY2Vzc2luZyBpbiBydW4oKVxuICAgICAgICBpZiAoY29uZmlnLm9ic2VydmFiaWxpdHkpIHtcbiAgICAgICAgICAgIHRoaXMub2JzZXJ2YWJpbGl0eUNvbmZpZyA9IGNvbmZpZy5vYnNlcnZhYmlsaXR5O1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5jb25zdHJ1Y3RzID0gbmV3IE1hcCgpO1xuICAgICAgICB0aGlzLm1vZHVsZXMgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gaW5pdGlhbGl6ZSB0aGUgbWFpbiBzdGFja1xuICAgICAgICBjb25zdCBhcHAgPSBuZXcgQXBwKCk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRBcHAoYXBwKTtcblxuICAgIH1cblxuICAgIHB1YmxpYyB1c2UoY29uc3RydWN0OiBGVzI0Q29uc3RydWN0KTogdGhpcyB7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0KTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgcHVibGljIHVzZU1vZHVsZShtb2R1bGU6IElGdzI0TW9kdWxlKTogdGhpcyB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ2FsbGVkIFVzZU1vZHVsZSB3aXRoIG1vZHVsZTogXCIsIHsgbW9kdWxlTmFtZTogbW9kdWxlLmdldE5hbWUoKSB9KTtcblxuICAgICAgICBpZiAodGhpcy5tb2R1bGVzLmhhcyhtb2R1bGUuZ2V0TmFtZSgpKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2R1bGUgd2l0aCBuYW1lICR7bW9kdWxlLmdldE5hbWUoKX0gaXMgYWxyZWFkeSByZWdpc3RlcmVkLmApO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5tb2R1bGVzLnNldChtb2R1bGUuZ2V0TmFtZSgpLCBtb2R1bGUpO1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3QgXSBvZiBtb2R1bGUuZ2V0Q29uc3RydWN0cygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiVXNlTW9kdWxlOiBSZWdpc3RlcmluZyBjb25zdHJ1Y3Q6IFwiLCBjb25zdHJ1Y3ROYW1lLCBtb2R1bGUuZ2V0RGVwZW5kZW5jaWVzKCksIGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgY29uc3RydWN0LmRlcGVuZGVuY2llcyA9IG1vZHVsZS5nZXREZXBlbmRlbmNpZXMoKTtcbiAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJDb25zdHJ1Y3QoY29uc3RydWN0LCBjb25zdHJ1Y3ROYW1lKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHVibGljIGFzeW5jIHJ1bigpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlJ1bm5pbmcgZncyNCBpbmZyYXN0cnVjdHVyZS4uLlwiKTtcblxuICAgICAgICAvLyAqKiogb3JkZXIgaXMgaW1wb3J0YW50IGhlcmUsIG1vZHVsZXMgbmVlZCB0byBiZSBwcm9jZXNzZWQgZmlyc3QsIGJlZm9yZSBjb25zdHJ1Y3RzICoqKlxuICAgICAgICB0aGlzLnByb2Nlc3NNb2R1bGVzKCk7XG5cbiAgICAgICAgY29uc3QgZGlzYWJsZVVJQ29uZmlnR2VuID0gRncyNC5nZXRJbnN0YW5jZSgpLmdldENvbmZpZygpLmRpc2FibGVVSUNvbmZpZ0dlbjtcblxuICAgICAgICBpZiAoIWRpc2FibGVVSUNvbmZpZ0dlbikge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy51aUNvbmZpZ0dlbi5ydW4oKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNvbmZpZ3VyZSBhIGJ1aWxkIGNvbW1hbmQgbGlrZSBpbiBwYWNrYWdlLmpzb24gdG8gb25seSBnZW5lcmF0ZSB0aGUgdWkgY29uZmlnXG4gICAgICAgIC8vIFwidWk6Z2VuXCI6IFwiVUlfR0VOX09OTFk9dHJ1ZSBlbnYtY21kIC1mIC5lbnYubG9jYWwgdHMtbm9kZSBzcmMvaW5kZXgudHNcIlxuICAgICAgICAvLyB0aGlzIGlzIHVzZWZ1bCBmb3IgZ2VuZXJhdGluZyB0aGUgdWkgY29uZmlnIGR1cmluZyBkZXZlbG9wbWVudFxuICAgICAgICBpZiAocHJvY2Vzcy5lbnYuVUlfR0VOX09OTFkgPT09ICd0cnVlJykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnVUkgY29uZmlnIGdlbmVyYXRpb24gY29tcGxldGUuIEV4aXRpbmcuJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgZGVmYXVsdCBmdzI0IHJ1bnRpbWUgbGF5ZXIgKE9OTFkgcnVudGltZSBjb2RlLCBub3QgaW5mcmFzdHJ1Y3R1cmUpXG4gICAgICAgIC8vIFRoaXMgbGF5ZXIgaXMgYXV0b21hdGljYWxseSBhdHRhY2hlZCB0byBhbGwgTGFtYmRhIGZ1bmN0aW9uc1xuICAgICAgICAvLyBJdCdzIE5PVCBhbiBlbnRyeSBwYWNrYWdlIC0gaXQncyBqdXN0IGF2YWlsYWJsZSBmb3IgaW1wb3J0c1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQnVpbGRpbmcgZncyNCBydW50aW1lIGxheWVyLi4uXCIpO1xuICAgICAgICBjb25zdCBmdzI0TGF5ZXIgPSBuZXcgTGF5ZXJDb25zdHJ1Y3QoWyB7XG4gICAgICAgICAgICBtb2RlOiAnQlVJTERfQU5EX1BBQ0tBR0UnLFxuICAgICAgICAgICAgLy8gQnVuZGxlIHRoZSBmdzI0IHJ1bnRpbWUgc291cmNlIChoYXMgaW1wb3J0cywgbmVlZHMgYnVuZGxpbmcgd2l0aCBlc2J1aWxkKVxuICAgICAgICAgICAgc291cmNlUGF0aDogJy4vbm9kZV9tb2R1bGVzL0B0ZW4yNGdyb3VwL2Z3MjQvZGlzdC9wYWNrYWdlL2xheWVyL2Z3MjQuanMnLFxuICAgICAgICAgICAgcGFja2FnZVBhdGg6ICdAdGVuMjRncm91cC9mdzI0JyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAwLFxuICAgICAgICAgICAgLy8gT3V0cHV0IHRvIGFwcGxpY2F0aW9uJ3MgZGlzdC9sYXllcnMgZGlyZWN0b3J5LCBub3QgZnJhbWV3b3JrJ3MgZGlyZWN0b3J5XG4gICAgICAgICAgICBkaXN0RGlyZWN0b3J5OiBwYXRoSm9pbihwcm9jZXNzLmN3ZCgpLCAnZGlzdC9sYXllcnMnKSxcbiAgICAgICAgICAgIGJ1aWxkT3B0aW9uczoge1xuICAgICAgICAgICAgICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBleHRlcm5hbDogWyAnQGF3cy1zZGsnLCAnQHNtaXRoeScgXSAvLyBBV1MgU0RLIGlzIE5PVCBwcm92aWRlZCBieSBMYW1iZGEgcnVudGltZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGlzRW50cnlQYWNrYWdlOiBmYWxzZSxcbiAgICAgICAgfSBdKTtcbiAgICAgICAgYXdhaXQgZncyNExheWVyLmNvbnN0cnVjdCgpO1xuXG4gICAgICAgIC8vIEJ1aWxkIHVzZXItZGVmaW5lZCBsYXllcnMgQkVGT1JFIG9ic2VydmFiaWxpdHkgc2V0dXBcbiAgICAgICAgLy8gVGhpcyBlbnN1cmVzIGVudHJ5IHBhY2thZ2VzIGFyZSByZWdpc3RlcmVkIGZvciBhbnkgbGFtYmRhcyBjcmVhdGVkIGJ5IG9ic2VydmFiaWxpdHkgRHluYW1vREJcbiAgICAgICAgYXdhaXQgdGhpcy5idWlsZFVzZXJMYXllcnMoKTtcblxuICAgICAgICAvLyBTZXR1cCBvYnNlcnZhYmlsaXR5IGluZnJhc3RydWN0dXJlIEFGVEVSIHVzZXIgbGF5ZXJzIGFyZSBidWlsdFxuICAgICAgICAvLyBUaGlzIGVuc3VyZXMgYW55IGxhbWJkYXMgY3JlYXRlZCBieSBvYnNlcnZhYmlsaXR5IGhhdmUgYWNjZXNzIHRvIGVudHJ5IHBhY2thZ2VzXG4gICAgICAgIGlmICh0aGlzLm9ic2VydmFiaWxpdHlDb25maWcpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2V0dXBPYnNlcnZhYmlsaXR5KHRoaXMub2JzZXJ2YWJpbGl0eUNvbmZpZyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0b3RhbENvbnN0cnVjdHMgPSB0aGlzLmNvbnN0cnVjdHMuc2l6ZTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgJHsnPScucmVwZWF0KDYwKX1gKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg8J+agCBCdWlsZGluZyAke3RvdGFsQ29uc3RydWN0c30gY29uc3RydWN0KHMpLi4uYCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCR7Jz0nLnJlcGVhdCg2MCl9XFxuYCk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5jb25zdHJ1Y3RBbGxSZXNvdXJjZXMoKVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCR7Jz0nLnJlcGVhdCg2MCl9YCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSBBbGwgY29uc3RydWN0cyBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5YCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCR7Jz0nLnJlcGVhdCg2MCl9XFxuYCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQnVpbGQgdXNlci1kZWZpbmVkIGxheWVyIGNvbnN0cnVjdHMgYmVmb3JlIG90aGVyIGNvbnN0cnVjdHMuXG4gICAgICogVGhpcyBlbnN1cmVzIGVudHJ5IHBhY2thZ2VzIGFyZSByZWdpc3RlcmVkIGJlZm9yZSBhbnkgbGFtYmRhcyBhcmUgY3JlYXRlZC5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIGJ1aWxkVXNlckxheWVycygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgbGF5ZXJDb25zdHJ1Y3RzID0gQXJyYXkuZnJvbSh0aGlzLmNvbnN0cnVjdHMuZW50cmllcygpKVxuICAgICAgICAgICAgLmZpbHRlcigoWyBfLCBjb25zdHJ1Y3QgXSkgPT4gY29uc3RydWN0Lm5hbWUgPT09ICdMYXllckNvbnN0cnVjdCcpXG4gICAgICAgICAgICAubWFwKChbIG5hbWUgXSkgPT4gbmFtZSk7XG5cbiAgICAgICAgaWYgKGxheWVyQ29uc3RydWN0cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEJ1aWxkaW5nICR7bGF5ZXJDb25zdHJ1Y3RzLmxlbmd0aH0gdXNlciBsYXllcihzKSBmaXJzdC4uLmApO1xuXG4gICAgICAgIGZvciAoY29uc3QgY29uc3RydWN0TmFtZSBvZiBsYXllckNvbnN0cnVjdHMpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29uc3RydWN0UmVzb3VyY2VzKGNvbnN0cnVjdE5hbWUpO1xuICAgICAgICB9XG4gICAgfVxuXG5cbiAgICBwcml2YXRlIHJlZ2lzdGVyQ29uc3RydWN0KGNvbnN0cnVjdDogRlcyNENvbnN0cnVjdCwgbmFtZT86IHN0cmluZykge1xuICAgICAgICBsZXQgY29uc3RydWN0TmFtZSA9IG5hbWUgfHwgY29uc3RydWN0Lm5hbWU7XG4gICAgICAgIGlmICh0aGlzLmNvbnN0cnVjdHMuaGFzKGNvbnN0cnVjdE5hbWUpKSB7XG4gICAgICAgICAgICAvLyBoYW5kbGUgbXVsdGlwbGUgY29uc3RydWN0cyBvZiBzYW1lIHR5cGVcbiAgICAgICAgICAgIGNvbnN0IG5ld0NvbnN0cnVjdE5hbWUgPSBjb25zdHJ1Y3ROYW1lLmNvbmNhdCgnLScsIHJhbmRvbVVVSUQoKSk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDb25zdHJ1Y3Qgd2l0aCBuYW1lICR7Y29uc3RydWN0TmFtZX0gaXMgYWxyZWFkeSByZWdpc3RlcmVkLCByZW5hbWluZyB0byAke25ld0NvbnN0cnVjdE5hbWV9YCk7XG4gICAgICAgICAgICBjb25zdHJ1Y3ROYW1lID0gbmV3Q29uc3RydWN0TmFtZTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmNvbnN0cnVjdHMuc2V0KGNvbnN0cnVjdE5hbWUsIGNvbnN0cnVjdCk7XG4gICAgICAgIHRoaXMuZncyNC5hZGRDb25zdHJ1Y3QoY29uc3RydWN0KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHByb2Nlc3NNb2R1bGVzKCkge1xuICAgICAgICBmb3IgKGNvbnN0IFsgbW9kdWxlTmFtZSwgbW9kdWxlIF0gb2YgdGhpcy5tb2R1bGVzKSB7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuYWRkTW9kdWxlKG1vZHVsZU5hbWUsIG1vZHVsZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGNvbnN0cnVjdEFsbFJlc291cmNlcygpIHtcbiAgICAgICAgY29uc3QgYWxsQ29uc3RydWN0cyA9IEFycmF5LmZyb20odGhpcy5jb25zdHJ1Y3RzLmtleXMoKSkubWFwKGNvbnN0cnVjdE5hbWUgPT4gdGhpcy5jb25zdHJ1Y3RSZXNvdXJjZXMoY29uc3RydWN0TmFtZSkpO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoYWxsQ29uc3RydWN0cyk7XG4gICAgfVxuXG4gICAgYXN5bmMgY29uc3RydWN0UmVzb3VyY2VzKGNvbnN0cnVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAvLyBDaGVjayBpZiBhbHJlYWR5IHByb2Nlc3NlZCBvciBpbiBwcm9ncmVzcyAtIHByZXZlbnQgZHVwbGljYXRlIGJ1aWxkc1xuICAgICAgICBpZiAodGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmhhcyhjb25zdHJ1Y3ROYW1lKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5nZXQoY29uc3RydWN0TmFtZSkhO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY29uc3RydWN0ID0gdGhpcy5jb25zdHJ1Y3RzLmdldChjb25zdHJ1Y3ROYW1lKTtcbiAgICAgICAgaWYgKCFjb25zdHJ1Y3QpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29uc3RydWN0ICR7Y29uc3RydWN0TmFtZX0gbm90IGZvdW5kYCk7XG4gICAgICAgIH1cblxuICAgICAgICB3aGlsZSAodGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSA+PSB0aGlzLnJlc291cmNlQ29uc3RydWN0TWF4Q29uY3VycmVuY3kpIHtcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDApKTsgLy8gVGhyb3R0bGUgaWYgY29uY3VycmVuY3kgbGltaXQgaXMgcmVhY2hlZFxuICAgICAgICB9XG5cbiAgICAgICAgLy8gT25seSBsb2cgaWYgdGhlcmUgYXJlIGFjdHVhbCBkZXBlbmRlbmNpZXNcbiAgICAgICAgaWYgKGNvbnN0cnVjdC5kZXBlbmRlbmNpZXMgJiYgY29uc3RydWN0LmRlcGVuZGVuY2llcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1Zyhg4o+zICR7Y29uc3RydWN0TmFtZX06IFdhaXRpbmcgZm9yIGRlcGVuZGVuY2llczogJHtjb25zdHJ1Y3QuZGVwZW5kZW5jaWVzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBXYWl0IGZvciBkZXBlbmRlbmNpZXMgdG8gcmVzb2x2ZVxuICAgICAgICBhd2FpdCB0aGlzLndhaXRGb3JEZXBlbmRlbmNpZXMoY29uc3RydWN0LmRlcGVuZGVuY2llcywgY29uc3RydWN0TmFtZSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg8J+UqCBCdWlsZGluZyAke2NvbnN0cnVjdE5hbWV9Li4uYCk7XG5cbiAgICAgICAgdGhpcy5yZXNvdXJjZUNvbnN0cnVjdEN1cnJlbnRDb25jdXJyZW5jeSsrO1xuICAgICAgICBjb25zdCB0aW1lciA9IFRpbWVyLnN0YXJ0KCk7XG4gICAgICAgIGNvbnN0IGNvbnN0cnVjdENvbXBsZXRpb25Qcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgY29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSAke2NvbnN0cnVjdE5hbWV9IGNvbXBsZXRlZCBpbiAke3RpbWVyLmVsYXBzZWRTZWNvbmRzKCl9YCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGDinYwgJHtjb25zdHJ1Y3ROYW1lfSBmYWlsZWQ6YCwgZXJyb3IpO1xuICAgICAgICAgICAgICAgIHRocm93IGVycm9yOyAvLyBSZS10aHJvdyB0byBlbnN1cmUgZGVwbG95bWVudCBmYWlsc1xuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc291cmNlQ29uc3RydWN0Q3VycmVudENvbmN1cnJlbmN5LS07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKCk7XG5cbiAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLnNldChjb25zdHJ1Y3ROYW1lLCBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZSk7XG4gICAgICAgIHJldHVybiBjb25zdHJ1Y3RDb21wbGV0aW9uUHJvbWlzZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHdhaXRGb3JEZXBlbmRlbmNpZXMoZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSwgY29uc3RydWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghZGVwZW5kZW5jaWVzIHx8IGRlcGVuZGVuY2llcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gZGVwZW5kZW5jaWVzLm1hcChkZXBlbmRlbmN5ID0+IHtcbiAgICAgICAgICAgIC8vIGlmIGRlcGVuZGVuY3kgY29uc3RydWN0IGRvZXMgbm90IGV4aXN0cyBpbiB0aGUgY29uc3RydWN0IGxpc3QsIG1hcmsgaXQgYXMgcHJvY2Vzc2VkXG4gICAgICAgICAgICBpZiAoIXRoaXMuY29uc3RydWN0cy5oYXMoZGVwZW5kZW5jeSkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtjb25zdHJ1Y3ROYW1lfTogRGVwZW5kZW5jeSAke2RlcGVuZGVuY3l9IG5vdCByZWdpc3RlcmVkIChvcHRpb25hbCBkZXBlbmRlbmN5KWApO1xuICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5zZXQoZGVwZW5kZW5jeSwgUHJvbWlzZS5yZXNvbHZlKCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCF0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgLy8gSWYgZGVwZW5kZW5jeSBub3Qgc2NoZWR1bGVkIHlldCwgbGlzdGVuIGZvciBpdHMgYWRkaXRpb25cbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnByb2Nlc3NlZENvbnN0cnVjdHMuaGFzKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJJbnRlcnZhbChpbnRlcnZhbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzZWRDb25zdHJ1Y3RzLmdldChkZXBlbmRlbmN5KSEudGhlbihyZXNvbHZlLCByZWplY3QpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LCAxMDApOyAvLyBDaGVjayBldmVyeSAxMDBtc1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc2VkQ29uc3RydWN0cy5nZXQoZGVwZW5kZW5jeSkhO1xuICAgICAgICB9KTtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNldHVwIG9ic2VydmFiaWxpdHkgaW5mcmFzdHJ1Y3R1cmUuXG4gICAgICogLSBgdHJ1ZWAgPSBEeW5hbW9EQiB3aXRoIGRlZmF1bHRzXG4gICAgICogLSBgeyBkeW5hbW9kYjogey4uLn0gfWAgPSBEeW5hbW9EQiB0YWJsZVxuICAgICAqIC0gYHsgY2xvdWR3YXRjaDogey4uLn0gfWAgPSBDdXN0b20gQ2xvdWRXYXRjaCBsb2cgZ3JvdXAgKG5vIER5bmFtb0RCKVxuICAgICAqIC0gYHsgZHluYW1vZGI6IHsuLi59LCBjbG91ZHdhdGNoOiB7Li4ufSB9YCA9IEJvdGhcbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHNldHVwT2JzZXJ2YWJpbGl0eShjb25maWc6IHRydWUgfCBJT2JzZXJ2YWJpbGl0eUluZnJhQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIHRydWUgPSBzaG9ydGhhbmQgZm9yIHsgZHluYW1vZGI6IHt9IH1cbiAgICAgICAgY29uc3QgY2ZnOiBJT2JzZXJ2YWJpbGl0eUluZnJhQ29uZmlnID0gY29uZmlnID09PSB0cnVlID8geyBkeW5hbW9kYjoge30gfSA6IGNvbmZpZztcblxuICAgICAgICAvLyBTZXR1cCBDbG91ZFdhdGNoIGlmIGNvbmZpZ3VyZWRcbiAgICAgICAgaWYgKGNmZy5jbG91ZHdhdGNoPy5lbmFibGVkICE9PSBmYWxzZSAmJiBjZmcuY2xvdWR3YXRjaCkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5zZXR1cE9ic2VydmFiaWxpdHlDbG91ZFdhdGNoKGNmZyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTZXR1cCBEeW5hbW9EQiBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmIChjZmcuZHluYW1vZGI/LmVuYWJsZWQgIT09IGZhbHNlICYmIGNmZy5keW5hbW9kYikge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5zZXR1cE9ic2VydmFiaWxpdHlEeW5hbW9EQihjZmcpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTG9nIGlmIG5laXRoZXIgYmFja2VuZCBpcyBjb25maWd1cmVkXG4gICAgICAgIGlmICghY2ZnLmR5bmFtb2RiICYmICFjZmcuY2xvdWR3YXRjaCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygn4pqg77iPIE9ic2VydmFiaWxpdHkgZW5hYmxlZCBidXQgbm8gYmFja2VuZHMgY29uZmlndXJlZCcpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0dXAgRHluYW1vREIgaW5mcmFzdHJ1Y3R1cmUgZm9yIG9ic2VydmFiaWxpdHkuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBzZXR1cE9ic2VydmFiaWxpdHlEeW5hbW9EQihjZmc6IElPYnNlcnZhYmlsaXR5SW5mcmFDb25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgZGIgPSBjZmcuZHluYW1vZGIhO1xuICAgICAgICAvLyBUYWJsZSBuYW1lOiB1c2UgZGIubmFtZSBpZiBwcm92aWRlZCwgb3RoZXJ3aXNlICdvYnNlcnZhYmlsaXR5bG9ncydcbiAgICAgICAgLy8gTm8gYXBwTmFtZSBwcmVmaXggLSBrZWVwcyB0YWJsZUtleSBzaW1wbGUgYW5kIGNvbnZlbnRpb24tYmFzZWRcbiAgICAgICAgY29uc3QgdGFibGVOYW1lID0gZGIubmFtZSA/PyAnb2JzZXJ2YWJpbGl0eWxvZ3MnO1xuXG4gICAgICAgIC8vIENoZWNrIGlmIHN0cmVhbSBuZWVkZWRcbiAgICAgICAgY29uc3QgaGFzU2VhcmNoSW5kZXhpbmcgPSBkYi5zZWFyY2hJbmRleGluZz8uc29tZSgoczogeyBlbmFibGVkPzogYm9vbGVhbiB9KSA9PiBzLmVuYWJsZWQpO1xuICAgICAgICBjb25zdCBoYXNTdHJlYW1Db25maWcgPSBkYi5zdHJlYW0/LmVuYWJsZWQ7XG4gICAgICAgIGNvbnN0IG5lZWRzU3RyZWFtID0gaGFzU2VhcmNoSW5kZXhpbmcgfHwgaGFzU3RyZWFtQ29uZmlnO1xuXG4gICAgICAgIC8vIERlZmF1bHQgdGFibGUgcHJvcHMgKDYgR1NJcylcbiAgICAgICAgY29uc3QgZGVmYXVsdFByb3BzID0ge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdwaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogbmVlZHNTdHJlYW0gPyBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBnbG9iYWxTZWNvbmRhcnlJbmRleGVzOiBbXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2kxJywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2kxcGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2kxc2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2kyJywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2kycGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2kyc2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2kzJywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2kzcGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2kzc2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k0JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k0cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k0c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k1JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k1cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k1c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k2JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k2cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k2c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k3JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k3cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k3c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k4JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k4cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k4c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICAgICAgeyBpbmRleE5hbWU6ICdnc2k5JywgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnc2k5cGsnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LCBzb3J0S2V5OiB7IG5hbWU6ICdnc2k5c2snLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9IH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgLi4uZGIucHJvcHMsXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgZHluYW1vQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KHtcbiAgICAgICAgICAgIHN0YWNrTmFtZTogY2ZnLnN0YWNrTmFtZSA/PyAncGVyc2lzdGVudCcsXG4gICAgICAgICAgICBwYXJlbnRTdGFja05hbWU6IGNmZy5wYXJlbnRTdGFja05hbWUsXG4gICAgICAgICAgICB0YWJsZToge1xuICAgICAgICAgICAgICAgIG5hbWU6IHRhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICBwcm9wczogZGVmYXVsdFByb3BzLFxuICAgICAgICAgICAgICAgIHN0cmVhbTogZGIuc3RyZWFtLFxuICAgICAgICAgICAgICAgIHNlYXJjaEluZGV4aW5nOiBkYi5zZWFyY2hJbmRleGluZyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGR5bmFtb0NvbnN0cnVjdC5uYW1lID0gJ29ic2VydmFiaWxpdHktZHluYW1vZGInO1xuICAgICAgICBhd2FpdCBkeW5hbW9Db25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgICAgLy8gQWRkIGdsb2JhbCByZXNvdXJjZSBhY2Nlc3MgLSBMYW1iZGFGdW5jdGlvbiBzZXRzIGVudiB2YXIgYXV0b21hdGljYWxseVxuICAgICAgICB0aGlzLmZ3MjQuYWRkR2xvYmFsUmVzb3VyY2VBY2Nlc3Moe1xuICAgICAgICAgICAgdGFibGVzOiBbIHsgbmFtZTogdGFibGVOYW1lLCBhY2Nlc3M6IFsgJ3JlYWR3cml0ZScgXSB9IF0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XG4gICAgICAgIGlmIChoYXNTZWFyY2hJbmRleGluZykgZmVhdHVyZXMucHVzaCgnc2VhcmNoJyk7XG4gICAgICAgIGlmIChoYXNTdHJlYW1Db25maWcpIGZlYXR1cmVzLnB1c2goJ3N0cmVhbScpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSBPYnNlcnZhYmlsaXR5OiAke3RhYmxlTmFtZX0ke2ZlYXR1cmVzLmxlbmd0aCA/ICcgKCcgKyBmZWF0dXJlcy5qb2luKCcsICcpICsgJyknIDogJyd9YCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0dXAgQ2xvdWRXYXRjaCBpbmZyYXN0cnVjdHVyZSBmb3Igb2JzZXJ2YWJpbGl0eS5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHNldHVwT2JzZXJ2YWJpbGl0eUNsb3VkV2F0Y2goY2ZnOiBJT2JzZXJ2YWJpbGl0eUluZnJhQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGN3ID0gY2ZnLmNsb3Vkd2F0Y2ghO1xuICAgICAgICBjb25zdCBhcHBOYW1lID0gdGhpcy5mdzI0LmdldENvbmZpZygpLm5hbWUgfHwgJ2FwcCc7XG4gICAgICAgIGNvbnN0IGxvZ0dyb3VwTmFtZSA9IGN3LmxvZ0dyb3VwTmFtZSA/PyBgL29ic2VydmFiaWxpdHkvJHthcHBOYW1lfWA7XG5cbiAgICAgICAgLy8gVE9ETzogQ3JlYXRlIGN1c3RvbSBsb2cgZ3JvdXAgd2hlbiBuZWVkZWRcbiAgICAgICAgLy8gRm9yIG5vdywganVzdCBzZXQgZW52IHZhciBzbyBydW50aW1lIGNhbiB1c2UgaXRcbiAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGUoJ09CU0VSVkFCSUxJVFlfTE9HX0dST1VQJywgbG9nR3JvdXBOYW1lKTtcblxuICAgICAgICBpZiAoY3cucmV0ZW50aW9uRGF5cykge1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGUoJ09CU0VSVkFCSUxJVFlfTE9HX1JFVEVOVElPTl9EQVlTJywgU3RyaW5nKGN3LnJldGVudGlvbkRheXMpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSBPYnNlcnZhYmlsaXR5IENsb3VkV2F0Y2g6ICR7bG9nR3JvdXBOYW1lfWApO1xuICAgIH1cblxufVxuIl19