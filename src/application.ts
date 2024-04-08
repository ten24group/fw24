import { App, Stack } from "aws-cdk-lib";
import { Fw24 } from "./core/fw24";
import { IApplicationConfig } from "./interfaces/config";
import { IStack } from "./interfaces/stack";
import { IFw24Module } from "./core/module";
import { UIConfigGen } from "./uiconfig/entity-ui-config.gen";



export class Application {
    private readonly fw24: Fw24;
    private readonly stacks: Map<string, IStack>;
    private readonly modules: Map<string, IFw24Module>; 

    constructor(config: IApplicationConfig = {}) {
        console.log("Initializing fw24 infrastructure...");

        this.fw24 = Fw24.getInstance();
        this.fw24.setConfig(config);

        this.stacks = new Map();
        this.modules = new Map();

        // initialize the main stack
        const app = new App();
        const mainStack = new Stack(app, `${config.name}-stack`)
        this.fw24.addStack("main", mainStack);
    }

    public use(stack: IStack): Application {
        this.registerStack(stack);
        return this;
    }

    public useModule(module: IFw24Module): Application{
        console.log("Called UseModule with module: ", { moduleName: module.getName(), module});
        
        if (this.modules.has(module.getName())) {
            throw new Error(`Stack with name ${module.getName()} is already registered.`);
        }

        this.modules.set(module.getName(), module);

        for (const [stackName, stack] of module.getStacks()){
            this.registerStack(stack, stackName);
        }

        return this;
    }

    public run() {
        console.log("Running fw24 infrastructure...");

        // *** order is important here, modules need to be processed first, before stacks ***
        this.processModules();

        // TODO: make it configurable
        if(true){
            const uiConfigGen = new UIConfigGen();
            uiConfigGen.run();
        }

        this.processStacks();
    }
    

    private registerStack(stack: IStack, name?: string) {
        const stackName = name || stack.constructor.name;
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
        console.log("Processing stacks...");

        if (executionTimes > 20) {
            throw new Error("Circular dependency detected");
        }

        for (const [stackName, stack] of this.stacks) {
            console.warn(`processStacks: loop: ${executionTimes}, stackName: ${stackName}, processed: ${processedStacks.has(stackName)}, processing: ${processingStacks.has(stackName)}`);
            if (!processedStacks.has(stackName) && !processingStacks.has(stackName)) {
                processingStacks.add(stackName);
                console.log(`Processing stack ${stackName} : processing: ${processingStacks.has(stackName)}`);
                await this.processStack(stack, executionTimes, processedStacks, processingStacks);
                processingStacks.delete(stackName);
            }
        }
    }

    private async processStack(stack: IStack, executionTimes: number, processedStacks: Set<string>, processingStacks: Set<string>) {
        if (stack.dependencies.length > 0) {
            for (const dependency of stack.dependencies) {
                if (!this.stacks.has(dependency)) {
                    //console.log(`Stack ${stack.constructor.name} depends on ${dependency} which is not in use in this infrasctructure.`);
                    continue;
                }
                if (!processedStacks.has(dependency)) {
                    console.log(`Stack ${stack.constructor.name} depends on ${dependency} which is not processed yet.`);
                    processingStacks.delete(stack.constructor.name);
                    return;
                }
            }
        }

        // Construct the stack
        await stack.construct();

        // Mark the stack as processed
        processedStacks.add(stack.constructor.name);

        // Remove the stack from the set of stacks to process
        this.stacks.delete(stack.constructor.name);

        // Process dependent stacks
        this.processStacks(executionTimes + 1, processedStacks, processingStacks);
    }
}
