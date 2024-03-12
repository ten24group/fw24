import { App, Stack } from "aws-cdk-lib";
import { IApplicationConfig } from "./interfaces/config";
import { Helper } from "./core/helper";

export class Application {
    app: App;
    mainStack: Stack;

    constructor(private config: IApplicationConfig) {
        console.log("Initializing fw24 infrastructure...");
        // Hydrate the config object with environment variables
        Helper.hydrateConfig(config);
        // Create a new CDK App instance
        this.app = new App();
        // Create a new CDK Stack instance for the main stack
        this.mainStack = new Stack(this.app, config.name + "-stack");
        // Set the global variables
       //Reflect.set(globalThis, "app", this.app);
        Reflect.set(globalThis, "mainStack", this.mainStack);
    }

    public use(stack: any): Application {
        stack.construct(this.config);
        return this;
    }
}
