import { App, Stack } from "aws-cdk-lib";
import { Fw24 } from "./core/fw24";
import { IApplicationConfig } from "./interfaces/config";
import { IStack } from "./interfaces/stack";
import { IFw24Module } from "./core/module";
import { EntityUIConfigGen } from "./ui-config-gen/entity-ui-config.gen";
import { ILogger, LogDuration, createLogger } from "./logging";



export class Application {
    readonly logger: ILogger;
    mainStack!: Stack;

    private readonly fw24: Fw24;
    private readonly stacks: Map<string, IStack>;
    private readonly modules: Map<string, IFw24Module>;
    private processedStacks: Map<string, Promise<void>> = new Map();
    private stackConstructMaxConcurrency: number = 10;
    private stackConstructCurrentConcurrency = 0;

    constructor(config: IApplicationConfig = {}) {
        this.logger = createLogger(`${Application.name}-${config.name}-${config.environment}`);
        
        this.logger.info("Initializing fw24 infrastructure...");

        this.fw24 = Fw24.getInstance();
        this.fw24.setConfig(config);

        this.stacks = new Map();
        this.modules = new Map();

        // initialize the main stack
        const app = new App();
        this.mainStack = new Stack(app, `${config.name}-stack`, {
            env: {
                account: config.account,
                region: config.region
            }
        })
        this.fw24.addStack("main", this.mainStack);
    }

    public use(stack: IStack): Application {
        this.registerStack(stack);
        return this;
    }

    public useModule(module: IFw24Module): Application{
        this.logger.debug("Called UseModule with module: ", { moduleName: module.getName(), module});
        
        if (this.modules.has(module.getName())) {
            throw new Error(`Stack with name ${module.getName()} is already registered.`);
        }

        this.modules.set(module.getName(), module);

        for (const [stackName, stack] of module.getStacks()){
            this.logger.info("UseModule: Registering stack: ", stackName, module.getDependencies(), stack.dependencies);
            stack.dependencies = module.getDependencies();
            this.registerStack(stack, stackName);
        }

        return this;
    }

    @LogDuration()
    public run() {
        this.logger.info("Running fw24 infrastructure...");

        // *** order is important here, modules need to be processed first, before stacks ***
        this.processModules();

        // TODO: make it configurable
        if(true){
            const uiConfigGen = new EntityUIConfigGen();
            uiConfigGen.run();
        }

        this.constructAllStacks().then(() => {
            console.log('All stacks completed');
        });
    }
    

    private registerStack(stack: IStack, name?: string) {
        const stackName = name || stack.constructor.name; // TODO: figure out a better approach, falling back to constructor name is very limiting
        if (this.stacks.has(stackName)) {
            throw new Error(`Stack with name ${stackName} is already registered.`);
        }
        this.stacks.set(stackName, stack);
    }


    private processModules(){
        for (const [moduleName, module] of this.modules) {
            this.fw24.addModule(moduleName, module);
        }
    }

    private constructAllStacks() {
        const allStacks = Array.from(this.stacks.keys()).map(stackName => this.constructStack(stackName));
        return Promise.allSettled(allStacks);
    }

    async constructStack(stackName: string): Promise<void> {
        const stack = this.stacks.get(stackName);
        if (!stack) {
            throw new Error(`Stack ${stackName} not found`);
        }

        while (this.stackConstructCurrentConcurrency >= this.stackConstructMaxConcurrency) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Throttle if concurrency limit is reached
        }

        this.logger.info(`Processing stack ${stackName}...`);

        // Wait for dependencies to resolve
        await this.waitForDependencies(stack.dependencies, stackName);

        this.stackConstructCurrentConcurrency++;
        const stackCompletionPromise = stack.construct()
            .then(() => {
                this.stackConstructCurrentConcurrency--;
            })
            .catch(error => {
                console.error(`Error executing stack ${stackName}:`, error);
                this.stackConstructCurrentConcurrency--;
                throw error; // Re-throw to ensure it can be handled or logged by Promise.allSettled
            });

        this.processedStacks.set(stackName, stackCompletionPromise);
        return stackCompletionPromise;
    }

    private async waitForDependencies(dependencies: string[], stackName: string): Promise<void> {
        const promises = dependencies.map(dependency => {
            if (!this.processedStacks.has(dependency)) {
                this.logger.info(`Stack ${stackName}: Waiting for dependency to be resolved ${dependency}...`);
                // If dependency not scheduled yet, listen for its addition
                return new Promise<void>((resolve, reject) => {
                    const interval = setInterval(() => {
                        if (this.processedStacks.has(dependency)) {
                            clearInterval(interval);
                            this.processedStacks.get(dependency)!.then(resolve, reject);
                            this.logger.info(`Stack ${stackName}: Dependency ${dependency} resolved.`);
                        }
                    }, 100); // Check every 100ms
                });
            }
            return this.processedStacks.get(dependency)!;
        });
        await Promise.all(promises);
    }

}
