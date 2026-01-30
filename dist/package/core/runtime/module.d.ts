import type { FW24Construct } from "../../interfaces/construct";
import { PolicyStatement, PolicyStatementProps } from "aws-cdk-lib/aws-iam";
export interface IModuleConfig {
}
export interface IFw24Module {
    getName(): string;
    getBasePath(): string;
    getConstructs(): Map<string, FW24Construct>;
    getControllersDirectory(): string;
    getLambdaEntryPackages(): string[];
    getServicesDirectory(): string;
    getQueuesDirectory(): string;
    getQueueFileNames(): string[];
    getDependencies(): string[];
    getTasksDirectory(): string;
    getTaskFileNames(): string[];
    getExportedPolicies(): Map<string, PolicyStatementProps | PolicyStatement>;
    getExportedEnvironmentVariables(): Map<string, string>;
}
export declare abstract class AbstractFw24Module implements IFw24Module {
    protected readonly config: IModuleConfig;
    constructor(config: IModuleConfig);
    abstract getConstructs(): Map<string, FW24Construct>;
    abstract getBasePath(): string;
    getName(): string;
    getControllersDirectory(): string;
    getServicesDirectory(): string;
    getQueuesDirectory(): string;
    getQueueFileNames(): string[];
    getTasksDirectory(): string;
    getTaskFileNames(): string[];
    getDependencies(): string[];
    getLambdaEntryPackages(): string[];
    getExportedPolicies(): Map<string, PolicyStatementProps | PolicyStatement>;
    getExportedEnvironmentVariables(): Map<string, string>;
}
