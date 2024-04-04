import { App, Stack } from "aws-cdk-lib";
import { IApplicationConfig } from "./interfaces/config";
import { Helper } from "./core/helper";
import { IFw24Module } from "./core/module";

export class Application {
    app: App;
    mainStack: Stack;
    protected modules: Map<string, IFw24Module>; 

    constructor(private config: IApplicationConfig = {}) {
        console.log("Initializing fw24 infrastructure...");
        // Hydrate the config object with environment variables
        Helper.hydrateConfig(config);
        // Create a new CDK App instance
        this.app = new App();
        // Create a new CDK Stack instance for the main stack
        this.mainStack = new Stack(this.app, config.name + "-stack");

        this.modules = new Map();

        // Set the global variables
       //Reflect.set(globalThis, "app", this.app);
        Reflect.set(globalThis, "mainStack", this.mainStack);
        Reflect.set(globalThis, "appModules", this.modules);
    }

    public useModule(module: IFw24Module){
        console.log("Called UseModule with module: ", { moduleName: module.getName(), module});
        
        this.modules.set(module.getName(), module);

        for (const stack of module.getStacks()){
            this.use(stack[1]);
        }

        return this;
    }

    public use(stack: any): Application {
        stack.construct(this.config);
        return this;
    }

}
