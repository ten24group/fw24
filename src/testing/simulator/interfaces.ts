import { Request, Response } from "../../interfaces";
import { Actor, ExecutionContext } from "../../core/types/execution-context";

export interface ISimulatorConfig {
    port?: number;
    dynamoDbPort?: number;
    sqsPort?: number;
    snsPort?: number;
    s3Port?: number;
    cognitoPort?: number;
    hotReload?: boolean;
    persistent?: boolean;
    dataDir?: string;
}

export interface ILambdaRunner {
    runHandler(
        handlerPath: string,
        handlerClassName: string,
        event: any,
        context: any,
        env?: Record<string, string>
    ): Promise<any>;
}

export interface IEmulator {
    name: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    getEndpoint(): string;
}

export interface IBridge {
    name: string;
    start(): Promise<void>;
    stop(): Promise<void>;
}

export interface ISimulator {
    start(): Promise<void>;
    stop(): Promise<void>;
}
