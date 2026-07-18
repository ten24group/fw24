interface CloudWatchLogsEvent {
    awslogs: {
        data: string;
    };
}
export declare const handler: (event: CloudWatchLogsEvent) => Promise<void>;
export {};
