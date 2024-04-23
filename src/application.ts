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

        this.processStacks();
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

    private async processStacks(executionTimes: number = 0, processedStacks: Set<string> = new Set(), processingStacks: Set<string> = new Set()) {
        this.logger.info(`Processing stacks... executionTimes: ${executionTimes}, processedStacks: ${Array.from(processedStacks)}, processingStacks: ${Array.from(processingStacks)}`);

        if (executionTimes > 20) {
            throw new Error("Circular dependency detected");
        }

        for (const [stackName, stack] of this.stacks) {
            if (!processedStacks.has(stackName) && !processingStacks.has(stackName)) {
                // this.logger.warn(`processStacks: loop: ${executionTimes}, stackName: ${stackName}, processed: ${processedStacks.has(stackName)}, processing: ${processingStacks.has(stackName)}`);
                processingStacks.add(stackName);

                this.logger.info(`Processing stack ${stackName} with dependencies: ${stack.dependencies} : processing: ${processingStacks.has(stackName)}, processedStacks: ${Array.from(processedStacks)}`);
               
                await this.processStack( stackName, stack, executionTimes, processedStacks, processingStacks);
               
                processingStacks.delete(stackName);
            }
        }
    }

    private async processStack(stackName:string, stack: IStack, executionTimes: number, processedStacks: Set<string>, processingStacks: Set<string>) {

        if (stack.dependencies.length > 0) {
            for (const dependency of stack.dependencies) {
                if (!this.stacks.has(dependency)) {
                    // this.logger.debug(`Stack ${stackName} depends on ${dependency} which is not in use in this infrastructure.`);
                    continue;
                }
                if (!processedStacks.has(dependency)) {
                    this.logger.info(`Stack ${stackName} depends on ${dependency} which is not processed yet.`);
                    processingStacks.delete(stackName);
                    return;
                }
            }
        }

        // Construct the stack
        await stack.construct();

        // Mark the stack as processed
        processedStacks.add(stackName);

        // Remove the stack from the set of stacks to process
        this.stacks.delete(stackName);

        // Process dependent stacks
        this.processStacks(executionTimes + 1, processedStacks, processingStacks);
    }
}
