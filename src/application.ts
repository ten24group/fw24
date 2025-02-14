import { App, Stack } from "aws-cdk-lib";
import { Fw24 } from "./core/fw24";
import { IApplicationConfig } from "./interfaces/config";
import { FW24Construct } from "./interfaces/construct";
import { IFw24Module } from "./core/runtime/module";
import { EntityUIConfigGen } from "./ui-config-gen/entity-ui-config.gen";
import { ILogger, LogDuration, createLogger } from "./logging";
import { LayerConstruct } from "./constructs";
import { randomUUID } from 'crypto';

export class Application {
    readonly logger: ILogger;
    mainStack!: Stack;

    private readonly fw24: Fw24;
    private readonly constructs: Map<string, FW24Construct>;
    private readonly modules: Map<string, IFw24Module>;
    private processedConstructs: Map<string, Promise<void>> = new Map();
    private resourceConstructMaxConcurrency: number = 10;
    private resourceConstructCurrentConcurrency = 0;

    constructor(config: IApplicationConfig = {}) {
        this.logger = createLogger([Application.name, config.name, config.environment].join('-'));
        
        this.logger.info("Initializing fw24 infrastructure...");

        this.fw24 = Fw24.getInstance();
        this.fw24.setConfig(config);
        
        if (config.environmentVariables) {
            Object.entries(config.environmentVariables).forEach(([key, value]) => {
                this.fw24.setEnvironmentVariable(key, value);
            })
        }

        // ensure there's a log-level set in the fw24 scope so that the constructs can ask for this value
        // this's only the global value, and can be overridden by each lambda function.
        if(!this.fw24.hasEnvironmentVariable('LOG_LEVEL')){
            this.fw24.setEnvironmentVariable('LOG_LEVEL', process.env.LOG_LEVEL || 'INFO' );
        }

        this.constructs = new Map();
        this.modules = new Map();

        // initialize the main stack
        const app = new App();
        this.fw24.setApp(app);
        
        // create the stacks based on names or default to main-stack
        if(!config.stackNames || config.stackNames.length === 0){
            config.stackNames = ['main'];
        }
        for(const stackName of config.stackNames){
            this.mainStack = new Stack(app, `${config.name}-${stackName}-stack`, {
                env: {
                    account: config.account,
                    region: config.region
                }
            })
            this.fw24.addStack(stackName, this.mainStack);
        }
    }

    public use(construct: FW24Construct): Application {
        this.registerConstruct(construct);
        return this;
    }

    public useModule(module: IFw24Module): Application{
        this.logger.debug("Called UseModule with module: ", { moduleName: module.getName()});
        
        if (this.modules.has(module.getName())) {
            throw new Error(`Module with name ${module.getName()} is already registered.`);
        }

        this.modules.set(module.getName(), module);

        for (const [constructName, construct] of module.getConstructs()){
            this.logger.info("UseModule: Registering construct: ", constructName, module.getDependencies(), construct.dependencies);
            construct.dependencies = module.getDependencies();
            this.registerConstruct(construct, constructName);
        }

        return this;
    }

    @LogDuration()
    public async run() {
        this.logger.info("Running fw24 infrastructure...");

        // build fw24 layer
        this.logger.info("Building fw24 layer...");
        const fw24Layer = new LayerConstruct([{
            layerName: 'fw24',
            sourcePath: './dist/layer'
        }]);
        fw24Layer.construct();

        // *** order is important here, modules need to be processed first, before constructs ***
        this.processModules();

        const disableUIConfigGen = Fw24.getInstance().getConfig().disableUIConfigGen;

        if(!disableUIConfigGen){
            const uiConfigGen = new EntityUIConfigGen();
            await uiConfigGen.run();
        }

        await this.constructAllResources()
        
        this.logger.info('All construct resource creation completed');
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
    }

    private processModules(){
        for (const [moduleName, module] of this.modules) {
            this.fw24.addModule(moduleName, module);
        }
    }

    private constructAllResources() {
        const allConstructs = Array.from(this.constructs.keys()).map(constructName => this.constructResources(constructName));
        return Promise.allSettled(allConstructs);
    }

    async constructResources(constructName: string): Promise<void> {
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
        const constructCompletionPromise = construct.construct()
            .then(() => {
                this.resourceConstructCurrentConcurrency--;
            })
            .catch(error => {
                console.error(`Error executing construct ${constructName}:`, error);
                this.resourceConstructCurrentConcurrency--;
                throw error; // Re-throw to ensure it can be handled or logged by Promise.allSettled
            });

        this.processedConstructs.set(constructName, constructCompletionPromise);
        return constructCompletionPromise;
    }

    private async waitForDependencies(dependencies: string[], constructName: string): Promise<void> {
        const promises = dependencies.map(dependency => {
            // if dependency construct does not exists in the construct list, mark it as processed
            if (!this.constructs.has(dependency)) {
                this.logger.info(`Dependency construct ${dependency} not found, marking it resolved.`);
                this.processedConstructs.set(dependency, Promise.resolve());
            }
            if (!this.processedConstructs.has(dependency)) {
                this.logger.info(`Construct ${constructName}: Waiting for dependency to be resolved ${dependency}...`);
                // If dependency not scheduled yet, listen for its addition
                return new Promise<void>((resolve, reject) => {
                    const interval = setInterval(() => {
                        if (this.processedConstructs.has(dependency)) {
                            clearInterval(interval);
                            this.processedConstructs.get(dependency)!.then(resolve, reject);
                            this.logger.info(`Construct ${constructName}: Dependency ${dependency} resolved.`);
                        }
                    }, 100); // Check every 100ms
                });
            }
            return this.processedConstructs.get(dependency)!;
        });
        await Promise.all(promises);
    }

}
