import { App, Stack } from "aws-cdk-lib";
import { Fw24 } from "./core/fw24";
import { IApplicationConfig } from "./interfaces/config";
import { IStack } from "./interfaces/stack";


export class Application {

    constructor(config: IApplicationConfig = {}) {
        console.log("Initializing fw24 infrastructure...");

        const fw24 = Fw24.getInstance();
        // set the config
        fw24.setConfig(config);

        // initialize the main stack
        const app = new App();
        const mainStack = new Stack(app, config.name + "-stack")

        // store the main stack in the framework scope
        fw24.addStack("main", mainStack);
    }

    public use(stack: IStack): Application {
        stack.construct();
        return this;
    }
}
