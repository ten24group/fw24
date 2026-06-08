export declare enum LambdaTestHarnessLogLevel {
    SILENT = 0,
    ERROR = 1,
    WARN = 2,
    INFO = 3,
    DEBUG = 4
}
export interface TestEventOptions {
    path?: string;
    httpMethod?: string;
    headers?: {
        [key: string]: string;
    };
    multiValueHeaders?: {
        [key: string]: string[];
    };
    queryStringParameters?: {
        [key: string]: string;
    };
    multiValueQueryStringParameters?: {
        [key: string]: string[];
    };
    pathParameters?: {
        [key: string]: string;
    };
    body?: any;
    isBase64Encoded?: boolean;
    requestContext?: any;
    resource?: string;
    stageVariables?: {
        [key: string]: string;
    };
    requestTimeEpoch?: number;
    resourcePath?: string;
    apiId?: string;
}
export interface TestContextOptions {
    callbackWaitsForEmptyEventLoop?: boolean;
    functionName?: string;
    functionVersion?: string;
    invokedFunctionArn?: string;
    memoryLimitInMB?: string;
    awsRequestId?: string;
    logGroupName?: string;
    logStreamName?: string;
    getRemainingTimeInMillis?: () => number;
    done?: () => void;
    fail?: () => void;
    succeed?: () => void;
}
export interface LambdaTestHarnessOptions {
    logLevel?: LambdaTestHarnessLogLevel;
    context?: TestContextOptions;
    /**
     * List of module paths to require before running tests, simulating Lambda layer entry packages
     */
    entryPackages?: string[];
}
export declare class LambdaTestHarness {
    private controller;
    private context;
    private logLevel;
    constructor(controller: any, options?: LambdaTestHarnessOptions);
    /**
     * Internal logging method that respects the configured log level
     */
    private log;
    private createMockEvent;
    private createMockContext;
    private createTestHandler;
    get(path: string, options?: TestEventOptions): Promise<any>;
    post(path: string, options?: TestEventOptions): Promise<any>;
    put(path: string, options?: TestEventOptions): Promise<any>;
    patch(path: string, options?: TestEventOptions): Promise<any>;
    delete(path: string, options?: TestEventOptions): Promise<any>;
}
