import { Stack } from "aws-cdk-lib";
import { Fw24 } from "./core/fw24";
import { IApplicationConfig } from "./interfaces/config";
import { FW24Construct } from "./interfaces/construct";
import { IFw24Module } from "./core/runtime/module";
import { EntityUIConfigGen } from "./ui-config-gen/entity-ui-config.gen";
import { ILogger } from "./logging";
export declare class Application {
    readonly logger: ILogger;
    mainStack: Stack;
    readonly fw24: Fw24;
    readonly uiConfigGen: EntityUIConfigGen;
    private readonly constructs;
    private readonly modules;
    private readonly processedConstructs;
    private readonly resourceConstructMaxConcurrency;
    private resourceConstructCurrentConcurrency;
    constructor(config?: IApplicationConfig);
    use(construct: FW24Construct): this;
    useModule(module: IFw24Module): this;
    run(): Promise<void>;
    /**
     * Build user-defined layer constructs before other constructs.
     * This ensures entry packages are registered before any lambdas are created.
     */
    private buildUserLayers;
    private registerConstruct;
    private processModules;
    private constructAllResources;
    constructResources(constructName: string): Promise<void>;
    private waitForDependencies;
}
