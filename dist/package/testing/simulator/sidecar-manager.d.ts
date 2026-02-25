import { SimulatedResource } from './cdk-parser';
export declare class SidecarManager {
    private readonly logger;
    private containers;
    private readonly prefix;
    constructor();
    initResources(resources: SimulatedResource[]): Promise<void>;
    private setupSQSQueue;
    private setupS3Bucket;
    private setupDynamoDBTable;
    startDynamoDB(port?: number): Promise<void>;
    startSQS(port?: number): Promise<void>;
    startS3(port?: number): Promise<void>;
    startMeiliSearch(port?: number, masterKey?: string): Promise<void>;
    startCognito(port?: number): Promise<void>;
    startSNS(port?: number): Promise<void>;
    private isDockerAvailable;
    private runContainer;
    private waitForHealthy;
    stopAll(): Promise<void>;
}
