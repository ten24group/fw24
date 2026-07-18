interface CloudWatchLogsEvent {
    awslogs: {
        data: string;
    };
}
interface LambdaContextLike {
    invokedFunctionArn?: string;
}
export declare const handler: (event: CloudWatchLogsEvent, context?: LambdaContextLike) => Promise<void>;
export {};
