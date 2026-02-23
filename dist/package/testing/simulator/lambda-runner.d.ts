import { ILambdaRunner } from './interfaces';
export declare class LambdaRunner implements ILambdaRunner {
    private readonly logger;
    runHandler(handlerPath: string, handlerClassName: string, event: any, context: any, env?: Record<string, string>): Promise<any>;
}
