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
    private readonly observabilityConfig?;
    constructor(config?: IApplicationConfig);
    use(construct: FW24Construct): this;
    useModule(module: IFw24Module): this;
    run(): Promise<void>;
    private registerConstruct;
    private processModules;
    private constructAllResources;
    constructResources(constructName: string): Promise<void>;
    private waitForDependencies;
    /**
     * Setup observability infrastructure.
     * - `true` = DynamoDB with defaults
     * - `{ dynamodb: {...} }` = DynamoDB table
     * - `{ cloudwatch: {...} }` = Custom CloudWatch log group (no DynamoDB)
     * - `{ dynamodb: {...}, cloudwatch: {...} }` = Both
     */
    private setupObservability;
    /**
     * Setup DynamoDB infrastructure for observability.
     */
    private setupObservabilityDynamoDB;
    /**
     * Setup CloudWatch infrastructure for observability.
     */
    private setupObservabilityCloudWatch;
}
