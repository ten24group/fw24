import { App, Stack } from "aws-cdk-lib";
import { AttributeType, StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import { Fw24 } from "./core/fw24";
import { IApplicationConfig, IObservabilityConfig, IObservabilityInfraConfig } from "./interfaces/config";
import { FW24Construct } from "./interfaces/construct";
import { IFw24Module } from "./core/runtime/module";
import { EntityUIConfigGen } from "./ui-config-gen/entity-ui-config.gen";
import { ILogger, LogDuration, createLogger } from "./logging";
import { DynamoDBConstruct, LayerConstruct } from "./constructs";
import { Timer } from "./utils";
import { randomUUID } from 'node:crypto';
import { join as pathJoin, resolve } from 'node:path';
import { ISimulatorConfig } from "./testing/simulator/interfaces";
import { SimulatorCoordinator } from "./testing/simulator/coordinator";
import { Helper } from "./core/helper";
import { HMRWatcher } from "./testing/simulator/hmr-watcher";

export class Application {
    readonly logger: ILogger;
    mainStack!: Stack;

    public readonly fw24: Fw24;
    public readonly uiConfigGen: EntityUIConfigGen;
    private readonly constructs: Map<string, FW24Construct>;
    private readonly modules: Map<string, IFw24Module>;
    private readonly processedConstructs: Map<string, Promise<void>> = new Map();
    private readonly resourceConstructMaxConcurrency: number = 10;
    private resourceConstructCurrentConcurrency = 0;
    private readonly observabilityConfig?: IObservabilityConfig;

    constructor(config: IApplicationConfig = {}) {
        this.logger = createLogger([ Application.name, config.name, config.environment ].join('-'));

        this.logger.info("Initializing fw24 infrastructure...");

        this.fw24 = Fw24.getInstance();
        this.uiConfigGen = new EntityUIConfigGen();
        this.fw24.setConfig(config);

        if (config.environmentVariables) {
            Object.entries(config.environmentVariables).forEach(([ key, value ]) => {
                this.fw24.setEnvironmentVariable(key, value);
            })
        }

        if (config.globalEnvironmentVariables) {
            Object.entries(config.globalEnvironmentVariables).forEach(([ key, value ]) => {
                this.fw24.setGlobalEnvironmentVariable(key, value);
            })
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
        const app = new App();
        this.fw24.setApp(app);

    }

    public use(construct: FW24Construct): this {
        this.registerConstruct(construct);
        return this;
    }

    public useModule(module: IFw24Module): this {
        this.logger.debug("Called UseModule with module: ", { moduleName: module.getName() });

        if (this.modules.has(module.getName())) {
            throw new Error(`Module with name ${module.getName()} is already registered.`);
        }

        this.modules.set(module.getName(), module);

        for (const [ constructName, construct ] of module.getConstructs()) {
            this.logger.info("UseModule: Registering construct: ", constructName, module.getDependencies(), construct.dependencies);
            construct.dependencies = module.getDependencies();
            this.registerConstruct(construct, constructName);
        }

        return this;
    }

    @LogDuration()
    public async run() {
        this.logger.info("Running fw24 infrastructure...");

        // *** order is important here, modules need to be processed first, before constructs ***
        this.processModules();

        const disableUIConfigGen = Fw24.getInstance().getConfig().disableUIConfigGen;

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
        const fw24Layer = new LayerConstruct([ {
            mode: 'BUILD_AND_PACKAGE',
            // Bundle the fw24 runtime source (has imports, needs bundling with esbuild)
            sourcePath: './node_modules/@ten24group/fw24/dist/package/layer/fw24.js',
            packagePath: '@ten24group/fw24',
            priority: 0,
            // Output to application's dist/layers directory, not framework's directory
            distDirectory: pathJoin(process.cwd(), 'dist/layers'),
            buildOptions: {
                sourcemap: true,
                external: [ '@aws-sdk', '@smithy' ] // AWS SDK is NOT provided by Lambda runtime
            },
            isEntryPackage: false,
        } ]);
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

        await this.constructAllResources()

        this.logger.info(`${'='.repeat(60)}`);
        this.logger.info(`✅ All constructs completed successfully`);
        this.logger.info(`${'='.repeat(60)}\n`);
    }

    /**
     * Build user-defined layer constructs before other constructs.
     * This ensures entry packages are registered before any lambdas are created.
     */
    private async buildUserLayers(): Promise<void> {
        const layerConstructs = Array.from(this.constructs.entries())
            .filter(([ _, construct ]) => construct.name === 'LayerConstruct')
            .map(([ name ]) => name);

        if (layerConstructs.length === 0) {
            return;
        }

        this.logger.info(`Building ${layerConstructs.length} user layer(s) first...`);

        for (const constructName of layerConstructs) {
            await this.constructResources(constructName);
        }
    }


    private registerConstruct(construct: FW24Construct, name?: string) {
        let constructName = name || construct.name;
        if (this.constructs.has(constructName)) {
            // handle multiple constructs of same type
            const newConstructName = constructName.concat('-', randomUUID());
            this.logger.info(`Construct with name ${constructName} is already registered, renaming to ${newConstructName}`);
            constructName = newConstructName;
        }
        this.constructs.set(constructName, construct);
        this.fw24.addConstruct(construct);
    }

    private processModules() {
        for (const [ moduleName, module ] of this.modules) {
            this.fw24.addModule(moduleName, module);
        }
    }

    private constructAllResources() {
        const allConstructs = Array.from(this.constructs.keys()).map(constructName => this.constructResources(constructName));
        return Promise.all(allConstructs);
    }

    async constructResources(constructName: string): Promise<void> {
        // Check if already processed or in progress - prevent duplicate builds
        if (this.processedConstructs.has(constructName)) {
            return this.processedConstructs.get(constructName)!;
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
        const timer = Timer.start();
        const constructCompletionPromise = (async () => {
            try {
                await construct.construct();
                this.logger.info(`✅ ${constructName} completed in ${timer.elapsedSeconds()}`);
            } catch (error) {
                this.logger.error(`❌ ${constructName} failed:`, error);
                throw error; // Re-throw to ensure deployment fails
            } finally {
                this.resourceConstructCurrentConcurrency--;
            }
        })();

        this.processedConstructs.set(constructName, constructCompletionPromise);
        return constructCompletionPromise;
    }

    private async waitForDependencies(dependencies: string[], constructName: string): Promise<void> {
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
                return new Promise<void>((resolve, reject) => {
                    const interval = setInterval(() => {
                        if (this.processedConstructs.has(dependency)) {
                            clearInterval(interval);
                            this.processedConstructs.get(dependency)!.then(resolve, reject);
                        }
                    }, 100); // Check every 100ms
                });
            }
            return this.processedConstructs.get(dependency)!;
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
    private async setupObservability(config: true | IObservabilityInfraConfig): Promise<void> {
        // true = shorthand for { dynamodb: {} }
        const cfg: IObservabilityInfraConfig = config === true ? { dynamodb: {} } : config;

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
    private async setupObservabilityDynamoDB(cfg: IObservabilityInfraConfig): Promise<void> {
        const db = cfg.dynamodb!;
        // Table name: use db.name if provided, otherwise 'observabilitylogs'
        // No appName prefix - keeps tableKey simple and convention-based
        const tableName = db.name ?? 'observabilitylogs';

        // Check if stream needed
        const hasSearchIndexing = db.searchIndexing?.some((s: { enabled?: boolean }) => s.enabled);
        const hasStreamConfig = db.stream?.enabled;
        const needsStream = hasSearchIndexing || hasStreamConfig;

        // Default table props (6 GSIs)
        const defaultProps = {
            partitionKey: { name: 'pk', type: AttributeType.STRING },
            sortKey: { name: 'sk', type: AttributeType.STRING },
            timeToLiveAttribute: 'ttl',
            dynamoStream: needsStream ? StreamViewType.NEW_AND_OLD_IMAGES : undefined,
            globalSecondaryIndexes: [
                { indexName: 'gsi1', partitionKey: { name: 'gsi1pk', type: AttributeType.STRING }, sortKey: { name: 'gsi1sk', type: AttributeType.STRING } },
                { indexName: 'gsi2', partitionKey: { name: 'gsi2pk', type: AttributeType.STRING }, sortKey: { name: 'gsi2sk', type: AttributeType.STRING } },
                { indexName: 'gsi3', partitionKey: { name: 'gsi3pk', type: AttributeType.STRING }, sortKey: { name: 'gsi3sk', type: AttributeType.STRING } },
                { indexName: 'gsi4', partitionKey: { name: 'gsi4pk', type: AttributeType.STRING }, sortKey: { name: 'gsi4sk', type: AttributeType.STRING } },
                { indexName: 'gsi5', partitionKey: { name: 'gsi5pk', type: AttributeType.STRING }, sortKey: { name: 'gsi5sk', type: AttributeType.STRING } },
                { indexName: 'gsi6', partitionKey: { name: 'gsi6pk', type: AttributeType.STRING }, sortKey: { name: 'gsi6sk', type: AttributeType.STRING } },
                { indexName: 'gsi7', partitionKey: { name: 'gsi7pk', type: AttributeType.STRING }, sortKey: { name: 'gsi7sk', type: AttributeType.STRING } },
                { indexName: 'gsi8', partitionKey: { name: 'gsi8pk', type: AttributeType.STRING }, sortKey: { name: 'gsi8sk', type: AttributeType.STRING } },
                { indexName: 'gsi9', partitionKey: { name: 'gsi9pk', type: AttributeType.STRING }, sortKey: { name: 'gsi9sk', type: AttributeType.STRING } },
            ],
            ...db.props,
        };

        const dynamoConstruct = new DynamoDBConstruct({
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
            tables: [ { name: tableName, access: [ 'readwrite' ] } ],
        });

        const features = [];
        if (hasSearchIndexing) features.push('search');
        if (hasStreamConfig) features.push('stream');

        this.logger.info(`✅ Observability: ${tableName}${features.length ? ' (' + features.join(', ') + ')' : ''}`);
    }

    /**
     * Setup CloudWatch infrastructure for observability.
     */
    private async setupObservabilityCloudWatch(cfg: IObservabilityInfraConfig): Promise<void> {
        const cw = cfg.cloudwatch!;
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
    public async simulate(config: ISimulatorConfig = {}) {
        this.logger.info("Starting FW24 Simulator...");

        const coordinator = new SimulatorCoordinator(config);

        const discover = async () => {
            this.logger.info("Discovering resources...");
            // 1. Discover Controllers
            const controllersDirectory = "./src/controllers";
            const apiRoutes: any[] = [];

            await Helper.registerHandlers(controllersDirectory, async (desc) => {
                const { handlerClass, filePath, fileName } = desc;
                const instance = new (handlerClass as any)();
                const controllerName = instance.controllerName;
                const routes = instance.routes || {};

                for (const [ routeKey, route ] of Object.entries(routes) as [ string, any ][]) {
                    const [ method, path ] = routeKey.split('|');
                    apiRoutes.push({
                        method,
                        path: `/${controllerName}${path}`,
                        handlerPath: resolve(filePath, fileName),
                        handlerClassName: handlerClass.name,
                        controllerName,
                        env: this.fw24.resolveEnvVariables(instance.controllerConfig?.env)
                    });
                }
            });

            coordinator.setApiRoutes(apiRoutes);

            // 2. Discover Queues
            const queuesDirectory = "./src/queues";
            const sqsSubs: any[] = [];
            await Helper.registerHandlers(queuesDirectory, async (desc) => {
                const { handlerClass, filePath, fileName } = desc;
                const instance = new (handlerClass as any)();
                const queueName = instance.queueName;

                sqsSubs.push({
                    queueName,
                    handlerPath: resolve(filePath, fileName),
                    handlerClassName: handlerClass.name,
                    env: this.fw24.resolveEnvVariables(instance.queueConfig?.env)
                });
            });

            coordinator.setSqsSubscriptions(sqsSubs);
        }

        await discover();

        // 3. Start Simulator
        await coordinator.start();

        // 4. Setup HMR
        if (config.hotReload !== false) {
            const watcher = new HMRWatcher('./src', async () => {
                this.logger.info("Change detected, reloading...");
                await discover();
            });
            watcher.start();
        }

        this.logger.info("Simulator started successfully!");

        return coordinator;
    }

}
