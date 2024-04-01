import { App, Stack } from "aws-cdk-lib";
import { Fw24 } from "./core/fw24";
import { IApplicationConfig } from "./interfaces/config";
import { IStack } from "./interfaces/stack";


export class Application {
    private stacks: Map<string, IStack>;
    private fw24: Fw24;

    constructor(config: IApplicationConfig = {}) {
        console.log("Initializing fw24 infrastructure...");

        this.fw24 = Fw24.getInstance();
        this.fw24.setConfig(config);
        this.stacks = new Map<string, IStack>();

        // initialize the main stack
        const app = new App();
        const mainStack = new Stack(app, `${config.name}-stack`)
        this.fw24.addStack("main", mainStack);
    }

    public use(stack: IStack): Application {
        this.registerStack(stack);
        return this;
    }

    public run() {
        console.log("Running fw24 infrastructure...");

        this.processStacks();
    }

    private registerStack(stack: IStack, name?: string) {
        const stackName = name || stack.constructor.name;
        if (this.stacks.has(stackName)) {
            throw new Error(`Stack with name ${stackName} is already registered.`);
        }
        this.stacks.set(stackName, stack);
    }


    private processStacks(executionTimes: number = 0, processedStacks: Set<string> = new Set()) {
        console.log("Processing stacks...");

        if (executionTimes > 20) {
            throw new Error("Circular dependency detected");
        }

        for (const [stackName, stack] of this.stacks) {
            if (!processedStacks.has(stackName)) {
                this.processStack(stack, executionTimes, processedStacks);
            }
        }
    }

    private processStack(stack: IStack, executionTimes: number, processedStacks: Set<string>) {
        if (stack.dependencies.length > 0) {
            for (const dependency of stack.dependencies) {
                if (!this.stacks.has(dependency)) {
                    //console.log(`Stack ${stack.constructor.name} depends on ${dependency} which is not in use in this infrasctructure.`);
                    continue;
                }
                if (!processedStacks.has(dependency)) {
                    console.log(`Stack ${stack.constructor.name} depends on ${dependency} which is not processed yet.`);
                    return;
                }
            }
        }

        // Construct the stack
        stack.construct();

        // Mark the stack as processed
        processedStacks.add(stack.constructor.name);

        // Remove the stack from the set of stacks to process
        this.stacks.delete(stack.constructor.name);

        // Process dependent stacks
        this.processStacks(executionTimes + 1, processedStacks);
    }
}
