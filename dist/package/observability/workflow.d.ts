export declare class WorkflowRun {
    private readonly workflowId;
    private readonly traceId;
    private readonly workflowName;
    constructor(workflowName: string, traceId?: `${string}-${string}-${string}-${string}-${string}`);
    recordStep<T>(stepName: string, fn: () => Promise<T>): Promise<T>;
    end(): void;
}
